import * as S3 from "aws-sdk/clients/s3";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as url from "url";

enum ResponseStatus {
    SUCCESS = "SUCCESS",
    FAILED = "FAILED",
}

const RequestType = {
    CREATE: "Create",
    UPDATE: "Update",
    DELETE: "Delete",
};

const CustomParameters = {
    BUCKET_NAME: "BucketName",
    OBJECT_PREFIX: "ObjectPrefix",
    CONTENT_VERSION: "ContentVersion",
};

interface ResultType {
    status: ResponseStatus,
    reason?: string,
}

type ResultCallback = (result: ResultType) => void;

type CloudformationEvent = any;
type CloudformationContext = any;

exports.handler = function(event: CloudformationEvent, context: CloudformationContext) { 
    console.log("REQUEST RECEIVED:\n" + JSON.stringify(event));

    const dir = fs.readdirSync(".");
    console.log(`Contents: ${JSON.stringify(dir)}`)

    const callback: ResultCallback = (result: ResultType) => {
        const responseData = {
            example: "response data"
        }
    
        sendResponse(event, context, result.status, result.reason);
    };

    try {
        validateArguments(event);
    } catch (errorMessage) {
        callback({
            status: ResponseStatus.FAILED,
            reason: errorMessage,
        });
        return;
    }

    switch (event.RequestType) {
        case RequestType.CREATE:
            handleCreate(event, context, callback);
            break;
        case RequestType.UPDATE:
            handleUpdate(event, context, callback);
            break;
        case RequestType.DELETE:
            handleDelete(event, context, callback);
            break;
        default:
            callback({
                status: ResponseStatus.FAILED,
                reason: `Unknown request type ${event.RequestType}`,
            });
            return;
    }
};

function validateArguments(event: CloudformationEvent) {
    const bucketName = getNewBucketName(event);
    if (!bucketName) {
        throw `${CustomParameters.BUCKET_NAME} must be specified.`;
    }
}

function handleCreate(event: CloudformationEvent, context: CloudformationContext, callback: ResultCallback) {
    const s3 = getS3Client();
    const bucketName = getNewBucketName(event) as string;
    const objectPrefix = getObjectPrefix(event);
    s3.listObjectsV2({Bucket: bucketName, Prefix: objectPrefix, MaxKeys: 1}, (err, data) => {
        if (err) {
            callback({
                status: ResponseStatus.FAILED,
                reason: `Unable to list objects in bucket. (${err})`,
            });
            return;
        };
        
        if (data.KeyCount && data.KeyCount > 0) {
            callback({
                status: ResponseStatus.FAILED,
                reason: "Bucket must be empty",
            });
            return;
        }

        syncFiles(event, callback);
    });
}

function handleUpdate(event: CloudformationEvent, context: CloudformationContext, callback: ResultCallback) {
    const s3 = getS3Client();
    const bucketName = getNewBucketName(event) as string;
    const objectPrefix = getObjectPrefix(event);
    deleteAllFiles(s3, bucketName, objectPrefix, result => {
        if (result.status === ResponseStatus.FAILED) {
            callback(result);
            return;
        } else {
            syncFiles(event, callback);
        }
    });
}

function handleDelete(event: CloudformationEvent, context: CloudformationContext, callback: ResultCallback) {
    const s3 = getS3Client();
    const bucketName = getNewBucketName(event) as string;
    const objectPrefix = getObjectPrefix(event);
    deleteAllFiles(s3, bucketName, objectPrefix, callback);
}

function deleteAllFiles(s3: S3, bucketName: string, objectPrefix: string | undefined, callback: ResultCallback) {
    s3.listObjectsV2({Bucket: bucketName, Prefix: objectPrefix}, (err, data) => {
        if (err) {
            callback({
                status: ResponseStatus.FAILED,
                reason: `Unable to list objects in bucket. (${err})`,
            });
            return;
        }

        if (data.KeyCount == 0) {
            callback({
                status: ResponseStatus.SUCCESS,
            });
            return;
        }

        const deleteParams = {
            Bucket: bucketName,
            Delete: {
                Objects: data.Contents?.map(content => ({ Key: content.Key })),
            }
        } as S3.DeleteObjectsRequest;
        
        s3.deleteObjects(deleteParams, (err, data) => {
            if (err) {
                callback({
                    status: ResponseStatus.FAILED,
                    reason: `Unable to delete objects from bucket. (${err}: ${JSON.stringify(err)})`,
                });
                return;
            }

            deleteAllFiles(s3, bucketName, objectPrefix, callback);
        });
    });
}

function syncFiles(event: CloudformationEvent, callback: ResultCallback) {
    const s3 = getS3Client();
    const bucketName = getNewBucketName(event) as string;
    const objectPrefix = getObjectPrefix(event);

    const allFiles = listAllFiles(".");
    let successCount = 0;
    allFiles.forEach(file => {
        uploadFile(s3, bucketName, objectPrefix, file, result => {
            if (result.status === ResponseStatus.FAILED) {
                callback(result);
                return;
            }
            successCount++;
            console.log("Success Count: " + successCount);
            if (successCount === allFiles.length) {
                callback({
                    status: ResponseStatus.SUCCESS,
                });
            }
        });
    });
}

function listAllFiles(root: string): string[] {
    const dirs = fs.readdirSync(root, {withFileTypes: true});
    let ret: string[] = [];
    for (const f of dirs) {
        const filePath = path.join(root, f.name);
        if (f.isDirectory()) {
            ret = ret.concat(listAllFiles(filePath));
        } else if (f.isFile()) {
            ret.push(filePath);
        }
    }
    return ret;
}

function uploadFile(s3: S3, bucketName: string, objectPrefix: string | undefined, fileName: string, callback: ResultCallback) {
    const fileContent = fs.readFileSync(fileName);

    const key = (objectPrefix || "") + fileName;

    // Setting up S3 upload parameters
    const params = {
        Bucket: bucketName,
        Key: key,
        Body: fileContent,
    };

    // Uploading files to the bucket
    s3.upload(params, (err: Error, data: S3.ManagedUpload.SendData) => {
        if (err) {
            callback({
                status: ResponseStatus.FAILED,
                reason: `Unable to upload file. (${err})`,
            });
            return;
        }

        callback({
            status: ResponseStatus.SUCCESS,
        });
    });
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

function getS3Client() {
    return new S3();
}

// Send response to the pre-signed S3 URL 
function sendResponse(event: CloudformationEvent, context: CloudformationContext, responseStatus: ResponseStatus, responseReason?: string, responseData?: object) {
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
 
    var request = https.request(options, function(response) {
        console.log("STATUS: " + response.statusCode);
        console.log("HEADERS: " + JSON.stringify(response.headers));
        // Tell AWS Lambda that the function execution is done  
        context.done();
    });
 
    request.on("error", function(error) {
        console.log("sendResponse Error:" + error);
        // Tell AWS Lambda that the function execution is done  
        context.done();
    });
  
    // write data to request body
    request.write(responseBody);
    request.end();
}