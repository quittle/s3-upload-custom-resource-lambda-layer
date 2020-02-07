import * as process from "process";
import { CloudFormation, S3 } from "aws-sdk/clients/all";
import { SimpleFs } from "../../src/simple-fs";
import * as path from "path";
import * as childProcess from "child_process";
import * as os from "os";
import { autoPaginate } from "../../src/aws-helper";

const LAYER_STACK_NAME = process.env.LAYER_STACK_NAME;

if (!LAYER_STACK_NAME) {
    throw new Error(`LAYER_STACK_NAME must be passed in as an environment variable when running this test.
            Run "LAYER_STACK_NAME=s3-upload-custom-resource-lambda-layer-beta jest tst" to test the layer`);
}

console.info(`Using Lambda Layer Stack: ${LAYER_STACK_NAME}`);

async function deleteStackIfExists(
    cloudFormation: CloudFormation,
    stackName: string
): Promise<void> {
    await cloudFormation.deleteStack({ StackName: stackName }).promise();
    await cloudFormation.waitFor("stackDeleteComplete", { StackName: stackName }).promise();
}

async function compareBucketContents(
    s3: S3,
    bucketName: string,
    expectedContentsFile: string
): Promise<void> {
    type ObjectDescription = {
        Key: string;
        Size?: number;
        ETag?: string;
        Metadata?: StringMap;
        ContentType?: string;
        ContentDisposition?: string;
    };
    const response = await s3.listObjectsV2({ Bucket: bucketName }).promise();
    const simpleResponse: ObjectDescription[] =
        response.Contents?.map(c => ({
            Key: c.Key as string,
            Size: c.Size,
            ETag: c.ETag
        })) ?? [];

    await Promise.all(
        simpleResponse.map(async response => {
            const description = await s3
                .headObject({ Bucket: bucketName, Key: response.Key })
                .promise();
            response.Metadata = description.Metadata;
            response.ContentType = description.ContentType;

            if (typeof description.ContentDisposition !== "undefined") {
                response.ContentDisposition = description.ContentDisposition;
            }
        })
    );
    const expectedResponse = new SimpleFs().readFile(expectedContentsFile).toString();
    expect(simpleResponse).toStrictEqual(JSON.parse(expectedResponse));
}

interface LayerStackOutputs {
    layerArn: string;
}

interface TestStackOutputs {
    rootBucketName: string;
    fooBarBucketName: string;
}

interface StringMap {
    [key: string]: string;
}

/* eslint-disable @typescript-eslint/no-non-null-assertion */
async function describeStack(
    cloudFormation: CloudFormation,
    stackName: string
): Promise<StringMap> {
    const descriptions = await cloudFormation.describeStacks({ StackName: stackName }).promise();
    return descriptions.Stacks![0]!.Outputs!.reduce(
        (accumulator: StringMap, output: CloudFormation.Output) => {
            return {
                [output.OutputKey!]: output.OutputValue,
                ...accumulator
            } as StringMap;
        },
        {}
    );
}
/* eslint-enable */

async function describeTestStack(
    cloudFormation: CloudFormation,
    stackName: string
): Promise<TestStackOutputs> {
    const stringMap = await describeStack(cloudFormation, stackName);
    return {
        rootBucketName: stringMap.RootTestBucketName,
        fooBarBucketName: stringMap.FooBarTestBucketName
    };
}

async function describeLayerStack(
    cloudFormation: CloudFormation,
    stackName: string
): Promise<LayerStackOutputs> {
    const stringMap = await describeStack(cloudFormation, stackName);
    return {
        layerArn: stringMap.LayerArn
    };
}

async function packageAndDeployExampleProject(args: {
    cloudFormation: CloudFormation;
    simpleFs: SimpleFs;
    stackName: string;
    layerArn: string;
    cloudformationBase: string;
    sourceRoot: string;
    outputFilePath: string;
    extraCloudFormationParameters?: StringMap;
}): Promise<TestStackOutputs> {
    const contents = args.simpleFs
        .readFile(args.cloudformationBase)
        .toString()
        .replace("!!!source-root!!!", args.sourceRoot);
    args.simpleFs.writeFile(args.outputFilePath, contents);

    childProcess.execSync(`aws cloudformation package \
            --template-file "${args.outputFilePath}" \
            --s3-bucket sam-915290536872 \
            --output-template-file "${args.outputFilePath}" \
            --use-json`);

    const generatedCloudFormationContents = JSON.parse(
        args.simpleFs.readFile(args.outputFilePath).toString()
    );
    const codeUri = generatedCloudFormationContents.Resources.TestUploaderLambda.Properties.CodeUri;
    const extraParameters = args.extraCloudFormationParameters
        ? Object.entries(args.extraCloudFormationParameters)
              .map(([key, value]) => `"${key}=${value}"`)
              .join(" ")
        : "";
    childProcess.execSync(`aws cloudformation deploy \
            --template-file "${args.outputFilePath}" \
            --stack-name "${args.stackName}" \
            --capabilities CAPABILITY_IAM \
            --parameter-overrides "UploadedContentVersion=${codeUri}" "S3UploadLambdaLayerArn=${args.layerArn}" ${extraParameters} \
            --no-fail-on-empty-changeset`);

    return await describeTestStack(args.cloudFormation, args.stackName);
}

describe("all tests", () => {
    const ASYNC_TIMEOUT_MS = 120_000;
    const TEST_STACK_NAME = "s3-upload-custom-resource-lambda-layer-test-stack";
    const TEST_BUCKET_STACK_NAME = "s3-upload-custom-resource-lambda-layer-bucket-test-stack";
    const exampleRoot = __dirname;
    const testDataDir = path.join(exampleRoot, "test-data");

    const cloudFormation = new CloudFormation();
    const s3 = new S3();
    const simpleFs = new SimpleFs();

    let layerArn: string;
    let tempDir: string;
    let generatedCloudFormationTemplateFile: string;

    beforeEach(async () => {
        layerArn = (await describeLayerStack(cloudFormation, LAYER_STACK_NAME)).layerArn;
        tempDir = path.join(os.tmpdir(), "__integration-test-tmp-dir__" + Math.random());
        generatedCloudFormationTemplateFile = path.join(tempDir, "example-cloudformation.yml");
        simpleFs.deleteFolder(tempDir);
        simpleFs.createFolder(tempDir);
        await Promise.all([
            deleteStackIfExists(cloudFormation, TEST_BUCKET_STACK_NAME),
            deleteStackIfExists(cloudFormation, TEST_STACK_NAME)
        ]);
    }, ASYNC_TIMEOUT_MS);

    afterEach(async () => {
        simpleFs.deleteFolder(tempDir);
        await Promise.all([
            deleteStackIfExists(cloudFormation, TEST_BUCKET_STACK_NAME),
            deleteStackIfExists(cloudFormation, TEST_STACK_NAME)
        ]);
    }, ASYNC_TIMEOUT_MS);

    test(
        "Create, Update, Delete Lifecycle",
        async () => {
            const template = path.join(exampleRoot, "cloudformation.yml");
            const { rootBucketName, fooBarBucketName } = await packageAndDeployExampleProject({
                cloudFormation,
                simpleFs,
                stackName: TEST_STACK_NAME,
                layerArn,
                cloudformationBase: template,
                sourceRoot: path.join(exampleRoot, "src-1"),
                outputFilePath: generatedCloudFormationTemplateFile
            });

            console.debug(
                `Cloudformation deployed successfully. Buckets for test => Root Bucket: ${rootBucketName}, FooBar Bucket: ${fooBarBucketName}`
            );

            await Promise.all([
                compareBucketContents(
                    s3,
                    rootBucketName,
                    path.join(testDataDir, "root-contents-1.txt")
                ),
                compareBucketContents(
                    s3,
                    fooBarBucketName,
                    path.join(testDataDir, "foo-bar-contents-1.txt")
                )
            ]);

            await packageAndDeployExampleProject({
                cloudFormation,
                simpleFs,
                stackName: TEST_STACK_NAME,
                layerArn,
                cloudformationBase: template,
                sourceRoot: path.join(exampleRoot, "src-2"),
                outputFilePath: generatedCloudFormationTemplateFile
            });

            await Promise.all([
                compareBucketContents(
                    s3,
                    rootBucketName,
                    path.join(testDataDir, "root-contents-2.txt")
                ),
                compareBucketContents(
                    s3,
                    fooBarBucketName,
                    path.join(testDataDir, "foo-bar-contents-2.txt")
                )
            ]);
        },
        ASYNC_TIMEOUT_MS
    );

    test(
        "Cannot create with folder already containing contents",
        async () => {
            const { rootBucketName } = await packageAndDeployExampleProject({
                cloudFormation,
                simpleFs,
                stackName: TEST_STACK_NAME,
                layerArn,
                cloudformationBase: path.join(exampleRoot, "cloudformation.yml"),
                sourceRoot: path.join(exampleRoot, "src-1"),
                outputFilePath: generatedCloudFormationTemplateFile
            });

            await expect(
                packageAndDeployExampleProject({
                    cloudFormation,
                    simpleFs,
                    stackName: TEST_BUCKET_STACK_NAME,
                    layerArn,
                    cloudformationBase: path.join(exampleRoot, "bucket-cloudformation.yml"),
                    sourceRoot: path.join(exampleRoot, "src-1"),
                    outputFilePath: generatedCloudFormationTemplateFile,
                    extraCloudFormationParameters: { BucketName: rootBucketName, ObjectPrefix: "" }
                })
            ).rejects.toThrow("Failed to create/update the stack");

            /* eslint-disable @typescript-eslint/unbound-method */
            const stacks: CloudFormation.ListStacksOutput[] = await autoPaginate<
                CloudFormation,
                CloudFormation.ListStacksInput,
                CloudFormation.ListStacksOutput
            >(cloudFormation, cloudFormation.listStacks, {
                StackStatusFilter: ["DELETE_COMPLETE"]
            });
            /* eslint-enable */

            const mostRecentStackId = stacks
                .reduce(
                    (acc: CloudFormation.StackSummary[], response) =>
                        acc.concat(response.StackSummaries || []),
                    []
                )
                .map(summary => ({
                    id: summary.StackId,
                    name: summary.StackName,
                    time: summary.DeletionTime!.getMilliseconds() // eslint-disable-line @typescript-eslint/no-non-null-assertion
                }))
                .filter(summary => summary.name === TEST_BUCKET_STACK_NAME)
                .sort((a, b) => b.time - a.time)[0].id;
            const events = await cloudFormation
                .describeStackEvents({ StackName: mostRecentStackId })
                .promise();
            const reason = events.StackEvents?.find(
                event => event.ResourceStatus === "CREATE_FAILED"
            )?.ResourceStatusReason;
            expect(reason).toEqual("Failed to create resource. Bucket must be empty");
        },
        ASYNC_TIMEOUT_MS
    );
});
