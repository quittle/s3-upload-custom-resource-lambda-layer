import { EventHandler, RequestParameters, ResultType } from "./handler";
import { SimpleS3 } from "../simple-s3";
import { SimpleFs } from "../simple-fs";
import { ResponseStatus } from "../cloudformation-types";

export class UpdateHandler extends EventHandler {
    protected async handleEvent(
        parameters: RequestParameters,
        simpleS3: SimpleS3,
        simpleFs: SimpleFs
    ): Promise<ResultType> {
        const { bucketName, objectPrefix } = parameters;

        let currentKeys;
        try {
            currentKeys = await simpleS3.listObjects(bucketName, objectPrefix);
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to list objects in bucket. (${e})`
            };
        }

        try {
            await Promise.all(currentKeys.map(key => simpleS3.deleteObject(bucketName, key)));
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to delete objects in ${bucketName}. (${e})`
            };
        }

        const files: string[] = simpleFs.listFiles(".");

        try {
            await Promise.all(
                files.map(async file => {
                    const contents = simpleFs.readFile(file);
                    return simpleS3.uploadFile(bucketName, objectPrefix, file, contents);
                })
            );
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to upload files to S3. (${e})`
            };
        }

        return {
            status: ResponseStatus.SUCCESS
        };
    }
}
