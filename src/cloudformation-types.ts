export enum ResponseStatus {
    SUCCESS = "SUCCESS",
    FAILED = "FAILED"
}

export enum RequestType {
    CREATE = "Create",
    UPDATE = "Update",
    DELETE = "Delete"
}

interface StringObject {
    [key: string]: string;
}

export interface CloudformationEvent {
    ResourceProperties: StringObject;
    RequestType: RequestType;
    StackId: unknown;
    RequestId: unknown;
    LogicalResourceId: unknown;
    ResponseURL: string;
}

export interface CloudformationContext {
    done: () => void;
}
