export type ActionEnvironment = 'development' | 'staging' | 'production';

export interface ActionResource {
  readonly type: string;
  readonly id: string;
}

export interface ActionRequest {
  readonly organizationId: string;

  readonly principal: {
    readonly type: 'agent';
    readonly id: string;
  };

  readonly action: {
    readonly name: string;
  };

  readonly resource?: ActionResource;

  readonly arguments: Readonly<Record<string, unknown>>;

  readonly context: {
    readonly environment: ActionEnvironment;
    readonly requestedAt: Date;
  };
}
