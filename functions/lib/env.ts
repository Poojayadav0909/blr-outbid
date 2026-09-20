export type HyperdriveBinding = { connectionString: string };

export type Env = {
  HYPERDRIVE: HyperdriveBinding;
  DODO_ENVIRONMENT?: string;
  DODO_API_KEY?: string;
  DODO_PRODUCT_ID?: string;
  DODO_WEBHOOK_SECRET?: string;
  DODO_PRODUCT_MIN?: string;
  PUBLIC_BASE_URL?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
};

export type RequestContext = {
  request: Request;
  env: Env;
  params: Record<string, string>;
  data: unknown;
};