import https from "https";
import url from "url";

import { CustomParameters } from "./resources";
import {
    ResponseStatus,
    RequestType,
    CloudformationEvent,
    CloudformationContext,
} from "./cloudformation-types";
import { ResultCallback, ResultType, CreateHandler, UpdateHandler, DeleteHandler } from "./handler";

function getNewBucketName(event: CloudformationEvent): string | undefined {
    return event.ResourceProperties[CustomParameters.BUCKET_NAME];
}

function getObjectPrefix(event: CloudformationEvent): string | undefined {
    return event.ResourceProperties[CustomParameters.OBJECT_PREFIX];
}

function validateArguments(event: CloudformationEvent): void {
    const bucketName = getNewBucketName(event);
    if (!bucketName) {
        throw new Error(`${CustomParameters.BUCKET_NAME} must be specified.`);
    }
}

function computePhysicalId(event: CloudformationEvent): string {
    return `Bucket: ${getNewBucketName(event)} ObjectPrefix: ${getObjectPrefix(event)}`;
}

// Send response to the pre-signed S3 URL
async function sendResponse(
    event: CloudformationEvent,
    context: CloudformationContext,
    responseStatus: ResponseStatus,
    responseReason?: string,
    responseData?: Record<string, unknown>
): Promise<void> {
    const responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: responseReason,
        PhysicalResourceId: computePhysicalId(event),
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData,
    });

    console.log("RESPONSE BODY:\n", responseBody);

    const parsedUrl = url.parse(event.ResponseURL);
    const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": responseBody.length,
        },
    };

    console.log("SENDING RESPONSE...\n");

    await new Promise<void>((resolve, reject) => {
        const request = https.request(options, function (response) {
            console.log(`STATUS: ${response.statusCode}`);
            console.log(`HEADERS: ${JSON.stringify(response.headers)}`);
            // Tell AWS Lambda that the function execution is done
            resolve();
        });

        request.on("error", function (error) {
            console.log("sendResponse Error: ", error);
            // Tell AWS Lambda that the function execution is done
            reject();
        });

        // write data to request body
        request.write(responseBody);
        request.end();
        console.log("End of sendResponse");
    });
}

async function handler(event: CloudformationEvent, context: CloudformationContext): Promise<void> {
    console.log("REQUEST RECEIVED:\n" + JSON.stringify(event));

    const callback: ResultCallback = async (result: ResultType): Promise<void> => {
        await sendResponse(event, context, result.status, result.reason);
    };

    try {
        validateArguments(event);
    } catch (e) {
        await callback({
            status: ResponseStatus.FAILED,
            reason: (e as Error).toString(),
        });
        return;
    }

    let handler;
    switch (event.RequestType) {
        case RequestType.CREATE:
            handler = new CreateHandler();
            break;
        case RequestType.UPDATE:
            handler = new UpdateHandler();
            break;
        case RequestType.DELETE:
            handler = new DeleteHandler();
            break;
        default:
            await callback({
                status: ResponseStatus.FAILED,
                reason: `Unknown request type ${event.RequestType as string}`,
            });
            return;
    }

    try {
        await handler.handle(event, callback);
    } catch (e) {
        await callback({
            status: ResponseStatus.FAILED,
            reason: (e as Error).toString(),
        });
        return;
    }
}

declare const exports: Record<string, unknown>;
exports.handler = handler;
