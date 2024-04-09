import { EventHandler, RequestParameters, ResultType } from "./handler";
import { ResponseStatus } from "../cloudformation-types";
import { SimpleS3 } from "../simple-s3";
import { SimpleFs } from "../simple-fs";
import { S3UploadConfig } from "../s3-upload-config";
import { S3_UPLOAD_CONFIG_FILE } from "../resources";

export class CreateHandler extends EventHandler {
    protected requireValidS3UploadConfig(): boolean {
        return true;
    }

    protected async handleEvent(
        parameters: RequestParameters,
        simpleS3: SimpleS3,
        simpleFs: SimpleFs,
        s3UploadFile?: S3UploadConfig,
    ): Promise<ResultType> {
        const { bucketName, objectPrefix } = parameters;
        let isBucketEmpty;
        try {
            isBucketEmpty = await simpleS3.isBucketEmpty(bucketName, objectPrefix);
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to list objects in bucket. (${(e as Error).toString()})`,
            };
        }

        if (!isBucketEmpty) {
            return {
                status: ResponseStatus.FAILED,
                reason: "Bucket must be empty",
            };
        }

        const files: string[] = simpleFs.listFiles(".");

        try {
            await Promise.all(
                files
                    .filter((file) => file !== S3_UPLOAD_CONFIG_FILE)
                    .map((file) => {
                        const contents = simpleFs.readFile(file);
                        const extraParams = s3UploadFile?.getS3ParamsForKey(file);
                        return simpleS3.uploadFile(
                            bucketName,
                            objectPrefix,
                            file,
                            contents,
                            extraParams,
                        );
                    }),
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
