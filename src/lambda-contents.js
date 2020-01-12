const aws = require("aws-sdk");
const fs = require("fs");
const path = require("path");

const ResponseStatus = {
    SUCCESS: "SUCCESS",
    FAILED: "FAILED",
};

const RequestType = {
    CREATE: "Create",
    UPDATE: "Update",
    DELETE: "Delete",
};

const CustomParameters = {
    BUCKET_NAME: "BucketName",
    CONTENTS: "Contents",
    OBJECT_PREFIX: "ObjectPrefix",
};

exports.handler = function(event, context) { 
    console.log("REQUEST RECEIVED:\n" + JSON.stringify(event));

    const dir = fs.readdirSync(".");
    console.log(`Contents: ${JSON.stringify(dir)}`)

    const callback = (result) => {
        const responseData = {
            example: "response data"
        }
    
        sendResponse(event, context, result.status, result.reason);
    };

    try {
        validateArguments(event, callback);
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

function validateArguments(event) {
    const bucketName = getNewBucketName(event);
    if (!bucketName) {
        throw `${CustomParameters.BUCKET_NAME} must be specified.`;
    }
}

function handleCreate(event, context, callback) {
    const s3 = getS3Client();
    const bucketName = getNewBucketName(event);
    const objectPrefix = getObjectPrefix(event);
    s3.listObjectsV2({Bucket: bucketName, Prefix: objectPrefix, MaxKeys: 1}, (err, data) => {
        if (err) {
            callback({
                status: ResponseStatus.FAILED,
                reason: `Unable to list objects in bucket. (${err})`,
            });
            return;
        };

        if (data.KeyCount > 0) {
            callback({
                status: ResponseStatus.FAILED,
                reason: "Bucket must be empty",
            });
            return;
        }

        syncFiles(event, callback);
    });
}

function handleUpdate(event, context, callback) {
    const s3 = getS3Client();
    const bucketName = getNewBucketName(event);
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

function handleDelete(event, context, callback) {
    const s3 = getS3Client();
    const bucketName = getNewBucketName(event);
    const objectPrefix = getObjectPrefix(event);
    deleteAllFiles(s3, bucketName, objectPrefix, callback);
}

function deleteAllFiles(s3, bucketName, objectPrefix, callback) {
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
                Objects: data.Contents.map(content => ({ Key: content.Key })),
            }
        };
        console.log(`data: ${JSON.stringify(data)} DeleteParams: ${JSON.stringify(deleteParams)}`);
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

function syncFiles(event, callback) {
    const s3 = getS3Client();
    const bucketName = getNewBucketName(event);
    const objectPrefix = getObjectPrefix(event);
    const contents = getContents(event);

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

function listAllFiles(root) {
    const dirs = fs.readdirSync(root, {withFileTypes: true});
    let ret = [];
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

function uploadFile(s3, bucketName, objectPrefix, fileName, callback) {
    const fileContent = fs.readFileSync(fileName);

    const key = (objectPrefix || "") + fileName;

    // Setting up S3 upload parameters
    const params = {
        Bucket: bucketName,
        Key: key,
        Body: fileContent,
    };

    // Uploading files to the bucket
    s3.upload(params, function(err, data) {
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

function computePhysicalId(event) {
    return `Bucket:${getNewBucketName(event)} ObjectPrefix: ${getObjectPrefix(event)}`;
}

function getContents(event) {
    return event.ResourceProperties[CustomParameters.CONTENTS];
}

function getNewBucketName(event) {
    return event.ResourceProperties[CustomParameters.BUCKET_NAME];
}

function getObjectPrefix(event) {
    return event.ResourceProperties[CustomParameters.OBJECT_PREFIX];
}

function getOldBucketName(event) {
    return event.OldResourceProperties[CustomParameters.BUCKET_NAME];
}

function getS3Client() {
    return new aws.S3();
}

// Send response to the pre-signed S3 URL 
function sendResponse(event, context, responseStatus, responseReason, responseData) {
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
 
    var https = require("https");
    var url = require("url");
 
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