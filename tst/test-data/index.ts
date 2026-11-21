import fooBarContents1 from "./foo-bar-contents-1.json";
import fooBarContents2 from "./foo-bar-contents-2.json";
import fooBarContents3 from "./foo-bar-contents-3.json";
import rootContents1 from "./root-contents-1.json";
import rootContents2 from "./root-contents-2.json";
import rootContents3 from "./root-contents-3.json";

interface S3Object {
    Key: string;
    Size: number;
    ETag: string;
    Metadata: { [key: string]: string | undefined };
    ContentType: string;
    ContentDisposition?: string;
    CacheControl?: string;
    WebsiteRedirectLocation?: string;
}

export {
    fooBarContents1,
    fooBarContents2,
    fooBarContents3,
    rootContents1,
    rootContents2,
    rootContents3,
    S3Object,
};
