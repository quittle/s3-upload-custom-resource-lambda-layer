import { EventHandler, ResultCallback, RequestParameters, ResultType } from "./handler";
import { ResponseStatus } from "./cloudformation-types";
import { SimpleS3 } from "./simple-s3";
import { SimpleFs } from "./simple-fs";

export class CreateHandler extends EventHandler {
    protected async handleEvent(parameters: RequestParameters, simpleS3: SimpleS3, simpleFs: SimpleFs): Promise<ResultType> {
        const { bucketName, objectPrefix } = parameters;
        let isBucketEmpty;
        try {
            isBucketEmpty = await simpleS3.isBucketEmpty(bucketName, objectPrefix);
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to list objects in bucket. (${e})`,
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
            await Promise.all(files.map(file => {
                const contents = simpleFs.readFile(file);
                return simpleS3.uploadFile(bucketName, objectPrefix, file, contents);
            }));
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to upload files to S3. (${e})`
            };
        }

        return {
            status: ResponseStatus.SUCCESS,
        };
    }
}