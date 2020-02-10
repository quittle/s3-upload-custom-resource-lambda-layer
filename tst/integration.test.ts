import process from "process";
import { CloudFormation, S3 } from "aws-sdk/clients/all";
import { SimpleFs } from "../src/simple-fs";
import path from "path";
import childProcess from "child_process";
import os from "os";
import { autoPaginate } from "../src/aws-helper";

import {
    fooBarContents1,
    fooBarContents2,
    rootContents1,
    rootContents2,
    S3Object
} from "./test-data";
import { describeStack, StringMap, deleteStackIfExists } from "./test-helpers";

const LAYER_STACK_NAME = process.env.LAYER_STACK_NAME;

if (!LAYER_STACK_NAME) {
    throw new Error(`LAYER_STACK_NAME must be passed in as an environment variable when running this test.
            Run "LAYER_STACK_NAME=s3-upload-custom-resource-lambda-layer-beta jest tst" to test the layer`);
}

if (!process.env.AWS_REGION) {
    throw new Error(
        "AWS_REGION must be passed in as an environment variable. The AWS JS SDK does not support AWS_DEFAULT_REGION."
    );
}

console.info(`Using Lambda Layer Stack: ${LAYER_STACK_NAME}`);

async function compareBucketContents(
    s3: S3,
    bucketName: string,
    expectedContents: S3Object[]
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

    expect(simpleResponse).toStrictEqual(expectedContents);
}

interface LayerStackOutputs {
    layerArn: string;
}

interface TestStackOutputs {
    rootBucketName: string;
    fooBarBucketName: string;
}

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

async function createStackAndExpectFailure(
    cloudFormation: CloudFormation,
    simpleFs: SimpleFs,
    stackName: string,
    layerArn: string,
    cloudformationBase: string,
    sourceRoot: string,
    generatedCloudFormationTemplateFile: string,
    extraCloudFormationParameters: StringMap,
    expectedFailureReason: string
): Promise<void> {
    await expect(
        packageAndDeployExampleProject({
            cloudFormation,
            simpleFs,
            stackName,
            layerArn,
            cloudformationBase: cloudformationBase,
            sourceRoot: sourceRoot,
            outputFilePath: generatedCloudFormationTemplateFile,
            extraCloudFormationParameters
        })
    ).rejects.toThrow("Failed to create/update the stack");

    await deleteStackIfExists(cloudFormation, stackName);

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
        .filter(summary => summary.StackName === stackName)
        .map(summary => ({
            id: summary.StackId,
            time: summary.DeletionTime!.getTime() // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }))
        .sort((a, b) => b.time - a.time)[0].id;

    const events = await cloudFormation
        .describeStackEvents({ StackName: mostRecentStackId })
        .promise();

    const reasons = events.StackEvents?.filter(
        event => event.ResourceStatus === "CREATE_FAILED"
    ).map(event => event.ResourceStatusReason);

    expect(reasons).toContain(expectedFailureReason);
}

describe("all tests", () => {
    const ASYNC_TIMEOUT_MS = 120_000;
    const TEST_STACK_NAME = "s3-upload-custom-resource-lambda-layer-test-stack";
    const TEST_BUCKET_STACK_NAME = "s3-upload-custom-resource-lambda-layer-bucket-test-stack";
    const exampleRoot = path.join(__dirname, "example-project");

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
                compareBucketContents(s3, rootBucketName, rootContents1),
                compareBucketContents(s3, fooBarBucketName, fooBarContents1)
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
                compareBucketContents(s3, rootBucketName, rootContents2),
                compareBucketContents(s3, fooBarBucketName, fooBarContents2)
            ]);
        },
        ASYNC_TIMEOUT_MS
    );

    test(
        "Cannot create with folder already containing contents",
        async () => {
            const sourceRoot = path.join(exampleRoot, "src-1");
            const { rootBucketName } = await packageAndDeployExampleProject({
                cloudFormation,
                simpleFs,
                stackName: TEST_STACK_NAME,
                layerArn,
                cloudformationBase: path.join(exampleRoot, "cloudformation.yml"),
                sourceRoot,
                outputFilePath: generatedCloudFormationTemplateFile
            });

            await createStackAndExpectFailure(
                cloudFormation,
                simpleFs,
                TEST_BUCKET_STACK_NAME,
                layerArn,
                path.join(exampleRoot, "bucket-cloudformation.yml"),
                sourceRoot,
                generatedCloudFormationTemplateFile,
                { BucketName: rootBucketName, ObjectPrefix: "" },
                "Failed to create resource. Bucket must be empty"
            );
        },
        ASYNC_TIMEOUT_MS
    );

    test(
        "Invalid config fails to deploy",
        async () => {
            await createStackAndExpectFailure(
                cloudFormation,
                simpleFs,
                TEST_STACK_NAME,
                layerArn,
                path.join(exampleRoot, "cloudformation.yml"),
                path.join(exampleRoot, "invalid-s3uploadconfig-src"),
                generatedCloudFormationTemplateFile,
                {},
                "Failed to create resource. Unable to read or parse .s3uploadconfig.json: SyntaxError: Unexpected token T in JSON at position 0"
            );
        },
        ASYNC_TIMEOUT_MS
    );
});
