import * as process from "process";
import { CloudFormation, S3 } from "aws-sdk/clients/all";
import { SimpleFs } from "../../src/simple-fs";
import * as path from "path";
import * as childProcess from "child_process";
import * as os from "os";

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
    const response = await s3.listObjectsV2({ Bucket: bucketName }).promise();
    const simpleResponse = response.Contents?.map(c => ({
        Key: c.Key,
        Size: c.Size,
        ETag: c.ETag
    }));
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

async function packageAndDeployExampleProject(
    cloudFormation: CloudFormation,
    simpleFs: SimpleFs,
    stackName: string,
    layerArn: string,
    exampleRoot: string,
    sourceRoot: string,
    outputFilePath: string
): Promise<TestStackOutputs> {
    const cloudFormationTemplate = path.join(exampleRoot, "cloudformation.yml");
    const contents = simpleFs
        .readFile(cloudFormationTemplate)
        .toString()
        .replace("!!!source-root!!!", sourceRoot);
    simpleFs.writeFile(outputFilePath, contents);

    childProcess.execSync(`aws cloudformation package \
            --template-file "${outputFilePath}" \
            --s3-bucket sam-915290536872 \
            --output-template-file "${outputFilePath}" \
            --use-json`);

    const generatedCloudFormationContents = JSON.parse(
        simpleFs.readFile(outputFilePath).toString()
    );
    const codeUri = generatedCloudFormationContents.Resources.TestUploaderLambda.Properties.CodeUri;

    childProcess.execSync(`aws cloudformation deploy \
            --template-file "${outputFilePath}" \
            --stack-name "${stackName}" \
            --capabilities CAPABILITY_IAM \
            --parameter-overrides "UploadedContentVersion=${codeUri}" "S3UploadLambdaLayerArn=${layerArn}" \
            --no-fail-on-empty-changeset`);

    return await describeTestStack(cloudFormation, stackName);
}

describe("all tests", () => {
    const ASYNC_TIMEOUT_MS = 60_000;
    const TEST_STACK_NAME = "s3-upload-custom-resource-lambda-layer-test-stack";
    const exampleRoot = __dirname;
    const tempDir = path.join(os.tmpdir(), "__integration-test-tmp-dir__");
    const generatedCloudFormationTemplateFile = path.join(tempDir, "example-cloudformation.yml");
    const testDataDir = path.join(exampleRoot, "test-data");

    const cloudFormation = new CloudFormation();
    const s3 = new S3();
    const simpleFs = new SimpleFs();

    let layerArn: string;

    beforeEach(async () => {
        layerArn = (await describeLayerStack(cloudFormation, LAYER_STACK_NAME)).layerArn;
        simpleFs.deleteFolder(tempDir);
        simpleFs.createFolder(tempDir);
        await deleteStackIfExists(cloudFormation, TEST_STACK_NAME);
    }, ASYNC_TIMEOUT_MS);

    afterEach(async () => {
        simpleFs.deleteFolder(tempDir);
        await deleteStackIfExists(cloudFormation, TEST_STACK_NAME);
    }, ASYNC_TIMEOUT_MS);

    test(
        "Create, Update, Delete Lifecycle",
        async () => {
            const { rootBucketName, fooBarBucketName } = await packageAndDeployExampleProject(
                cloudFormation,
                simpleFs,
                TEST_STACK_NAME,
                layerArn,
                exampleRoot,
                path.join(exampleRoot, "src-1"),
                generatedCloudFormationTemplateFile
            );

            console.debug(
                `Cloudformation deployed successfully. Buckets for test => Root Bucket: ${rootBucketName}, FooBar Bucket: ${fooBarBucketName}`
            );

            await compareBucketContents(
                s3,
                rootBucketName,
                path.join(testDataDir, "root-contents-1.txt")
            );
            await compareBucketContents(
                s3,
                fooBarBucketName,
                path.join(testDataDir, "foo-bar-contents-1.txt")
            );

            console.debug("Contents are as expected for src-1");

            await packageAndDeployExampleProject(
                cloudFormation,
                simpleFs,
                TEST_STACK_NAME,
                layerArn,
                exampleRoot,
                path.join(exampleRoot, "src-2"),
                generatedCloudFormationTemplateFile
            );

            await compareBucketContents(
                s3,
                rootBucketName,
                path.join(testDataDir, "root-contents-2.txt")
            );
            await compareBucketContents(
                s3,
                fooBarBucketName,
                path.join(testDataDir, "foo-bar-contents-2.txt")
            );

            console.debug("Contents are as expected for src-2");
        },
        ASYNC_TIMEOUT_MS
    );
});
