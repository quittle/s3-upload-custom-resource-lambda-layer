import CloudFormation from "aws-sdk/clients/cloudformation";

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
                ...accumulator,
            } as StringMap;
        },
        {}
    );
}
/* eslint-enable */

async function deleteStackIfExists(
    cloudFormation: CloudFormation,
    stackName: string
): Promise<void> {
    await cloudFormation.deleteStack({ StackName: stackName }).promise();
    await cloudFormation.waitFor("stackDeleteComplete", { StackName: stackName }).promise();
}

export { describeStack, deleteStackIfExists, StringMap };
