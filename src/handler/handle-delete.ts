import { EventHandler, RequestParameters, ResultType } from "./handler";
import { SimpleS3 } from "../simple-s3";
import { SimpleFs } from "../simple-fs";
import { ResponseStatus } from "../cloudformation-types";

export class DeleteHandler extends EventHandler {
    protected async handleEvent(
        parameters: RequestParameters,
        simpleS3: SimpleS3,
        _simpleFs: SimpleFs
    ): Promise<ResultType> {
        const { bucketName, objectPrefix } = parameters;

        let keys;
        try {
            keys = await simpleS3.listObjects(bucketName, objectPrefix);
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to list objects in ${bucketName}. (${(e as Error).toString()})`,
            };
        }
        try {
            await Promise.all(keys.map((key) => simpleS3.deleteObject(bucketName, key)));
        } catch (e) {
            return {
                status: ResponseStatus.FAILED,
                reason: `Unable to delete objects in ${bucketName}. (${(e as Error).toString()})`,
            };
        }

        return {
            status: ResponseStatus.SUCCESS,
        };
    }
}
