import fooBarContents1 from "./foo-bar-contents-1.json";
import fooBarContents2 from "./foo-bar-contents-2.json";
import rootContents1 from "./root-contents-1.json";
import rootContents2 from "./root-contents-2.json";

interface S3Object {
    Key: string;
    Size: number;
    ETag: string;
    Metadata: { [key: string]: string };
    ContentType: string;
    ContentDisposition?: string;
}

export { fooBarContents1, fooBarContents2, rootContents1, rootContents2, S3Object };
