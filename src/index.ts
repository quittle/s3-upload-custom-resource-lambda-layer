import * as https from "https";
import * as url from "url";

import { CustomParameters } from "./resources";
import { ResponseStatus, RequestType, CloudformationEvent, CloudformationContext } from "./cloudformation-types";
import { ResultCallback, ResultType } from "./handler";
import { CreateHandler } from "./handle-create";
import { DeleteHandler } from "./handle-delete";
import { UpdateHandler } from "./handle-update";

exports.handler = async function(event: CloudformationEvent, context: CloudformationContext): Promise<void> {
    console.log("REQUEST RECEIVED:\n" + JSON.stringify(event));

    const callback: ResultCallback = async (result: ResultType) => {
        await sendResponse(event, context, result.status, result.reason);
    };

    try {
        validateArguments(event);
    } catch (errorMessage) {
        return await callback({
            status: ResponseStatus.FAILED,
            reason: errorMessage,
        });
    }

    switch (event.RequestType) {
        case RequestType.CREATE:
            return await new CreateHandler().handle(event, context, callback);
        case RequestType.UPDATE:
            return await new UpdateHandler().handle(event, context, callback);
        case RequestType.DELETE:
            return await new DeleteHandler().handle(event, context, callback);
        default:
            return await callback({
                status: ResponseStatus.FAILED,
                reason: `Unknown request type ${event.RequestType}`,
            });
    }
};

function validateArguments(event: CloudformationEvent) {
    const bucketName = getNewBucketName(event);
    if (!bucketName) {
        throw `${CustomParameters.BUCKET_NAME} must be specified.`;
    }
}

function computePhysicalId(event: CloudformationEvent): string {
    return `Bucket:${getNewBucketName(event)} ObjectPrefix: ${getObjectPrefix(event)}`;
}

function getNewBucketName(event: CloudformationEvent): string | undefined {
    return event.ResourceProperties[CustomParameters.BUCKET_NAME];
}

function getObjectPrefix(event: CloudformationEvent): string | undefined {
    return event.ResourceProperties[CustomParameters.OBJECT_PREFIX];
}

// Send response to the pre-signed S3 URL
async function sendResponse(event: CloudformationEvent, context: CloudformationContext, responseStatus: ResponseStatus, responseReason?: string, responseData?: object): Promise<void> {
    var responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: responseReason,
        PhysicalResourceId: computePhysicalId(event),
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData
    });

    console.log("RESPONSE BODY:\n", responseBody);

    var parsedUrl = url.parse(event.ResponseURL);
    var options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": responseBody.length
        }
    };

    console.log("SENDING RESPONSE...\n");

    await new Promise((resolve, reject) => {
        const request = https.request(options, function(response) {
            console.log("STATUS: " + response.statusCode);
            console.log("HEADERS: " + JSON.stringify(response.headers));
            // Tell AWS Lambda that the function execution is done
            resolve();
        });

        request.on("error", function(error) {
            console.log("sendResponse Error:" + error);
            // Tell AWS Lambda that the function execution is done
            reject();
        });

        // write data to request body
        request.write(responseBody);
        request.end();
        console.log("End of sendResponse");
    });
}