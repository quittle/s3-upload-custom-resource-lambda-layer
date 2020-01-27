import { AWSError } from "aws-sdk/lib/error";
import { Request } from "aws-sdk/lib/request";

/** Represents an AWS Request for a pagable API */
type PagableAwsRequest = {
    NextToken?: string;
    ContinuationToken?: string;
};

/** Represents an AWS Response for a pagable API */
type PagableAwsResponse = {
    NextToken?: string;
    NextContinuationToken?: string;
};

/** Represents an AWS request's parameters. Specifically, one that suports pagination  */
type AwsRequest<I> = I & PagableAwsRequest;

/** Represents an AWS request's response. Specifically, one that supports pagination  */
type AwsResponse<O> = O & PagableAwsResponse;

/**
 * Represents an AWS request method on a service
 */
type AwsMethod<I extends PagableAwsRequest, O extends PagableAwsResponse> = (
    request: AwsRequest<I>,
    callback?: (err: AWSError, data: AwsResponse<O>) => void
) => Request<O, AWSError>;

/**
 * Automate the pagination of a request to AWS with the JS SDK. Many AWS APIs are modeled with
 * overloaded methods, which can cause TypeScript issues, so you may have to explicitly provide
 * generic typing to fix TS compiler errors.
 * @template Service The AWS service class
 * @template I The API request class. Usually suffixed with "Input"
 * @template O The API response class. Usually suffixed with "Output"
 * @param instance The instance to make the request with
 * @param method This should be a method on the instance passed in and will be invoked on the
 *               instance.
 * @param data The request parameters.
 */
async function autoPaginate<Service, I extends PagableAwsRequest, O extends PagableAwsResponse>(
    instance: Service,
    method: AwsMethod<I, O>,
    data: AwsRequest<I>
): Promise<Array<AwsResponse<O>>> {
    const ret: Array<AwsResponse<O>> = [];
    let nextToken = null;
    let nextContinuationToken = null;
    do {
        if (nextToken) {
            data.NextToken = nextToken;
        }
        if (nextContinuationToken) {
            data.ContinuationToken = nextContinuationToken;
        }

        const response: AwsResponse<O> = await method.apply(instance, [data]).promise();
        ret.push(response);

        nextToken = response.NextToken;
        nextContinuationToken = response.NextContinuationToken;
    } while (nextToken || nextContinuationToken);
    return ret;
}

export { autoPaginate };
