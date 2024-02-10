import {
    CloudFormation,
    waitUntilStackDeleteComplete,
    Output,
} from "@aws-sdk/client-cloudformation";

interface StringMap {
    [key: string]: string;
}

/* eslint-disable @typescript-eslint/no-non-null-assertion */
async function describeStack(
    cloudFormation: CloudFormation,
    stackName: string
): Promise<StringMap> {
    const descriptions = await cloudFormation.describeStacks({ StackName: stackName });
    return descriptions.Stacks![0]!.Outputs!.reduce((accumulator: StringMap, output: Output) => {
        return {
            [output.OutputKey!]: output.OutputValue,
            ...accumulator,
        } as StringMap;
    }, {});
}
/* eslint-enable */

async function deleteStackIfExists(
    cloudFormation: CloudFormation,
    stackName: string
): Promise<void> {
    await cloudFormation.deleteStack({ StackName: stackName });
    await waitUntilStackDeleteComplete(
        { client: cloudFormation, maxWaitTime: Number.MAX_VALUE },
        { StackName: stackName }
    );
}

export { describeStack, deleteStackIfExists, StringMap };
