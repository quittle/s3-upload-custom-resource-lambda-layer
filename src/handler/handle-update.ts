import { EventHandler, RequestParameters, ResultType } from "./handler";
import { SimpleS3 } from "../simple-s3";
import { SimpleFs } from "../simple-fs";
import { ResponseStatus } from "../cloudformation-types";
import { S3UploadConfig } from "../s3-upload-config";
import { S3_UPLOAD_CONFIG_FILE } from "../resources";

export class UpdateHandler extends EventHandler {
    protected async handleEvent(
        parameters: RequestParameters,
        simpleS3: SimpleS3,
        simpleFs: SimpleFs,
        s3UploadFile?: S3UploadConfig
    ): Promise<ResultType> {
        const { bucketName, objectPrefix } = parameters;

        let currentKeys;
        try {
            currentKeys = await simpleS3.listObjects(bucketName, objectPrefix);
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to list objects in bucket. (${(e as Error).toString()})`,
            };
        }

        try {
            await Promise.all(currentKeys.map((key) => simpleS3.deleteObject(bucketName, key)));
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to delete objects in ${bucketName}. (${(e as Error).toString()})`,
            };
        }

        const files: string[] = simpleFs.listFiles(".");

        try {
            await Promise.all(
                files
                    .filter((file) => file !== S3_UPLOAD_CONFIG_FILE)
                    .map(async (file) => {
                        const contents = simpleFs.readFile(file);
                        const extraParams = s3UploadFile?.getS3ParamsForKey(file);
                        return simpleS3.uploadFile(
                            bucketName,
                            objectPrefix,
                            file,
                            contents,
                            extraParams
                        );
                    })
            );
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to upload files to S3. (${(e as Error).toString()})`,
            };
        }

        return {
            status: ResponseStatus.SUCCESS,
        };
    }
}
