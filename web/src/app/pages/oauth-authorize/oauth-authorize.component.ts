import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { api } from 'convex/_generated/api';
import {
  nucleoArrowRight as ArrowRight,
  nucleoConnection as Cable,
  nucleoCheck as Check,
  NucleoIcon,
  nucleoShield as ShieldCheck,
} from '@kualia/icons';
import { ConvexService } from '../../services/convex.service';

const MAX_CONVEX_AUTH_WAIT_MS = 10000;
const CONVEX_AUTH_CHECK_INTERVAL_MS = 100;

interface OAuthAuthorizeParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  state?: string;
  resource?: string;
}

interface OAuthClientInfo {
  clientId: string;
  clientName?: string;
  clientUri?: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
}

interface OAuthScopeDescription {
  name: string;
  description: string;
  isWrite: boolean;
}

const OAUTH_SCOPE_DESCRIPTIONS: Record<string, OAuthScopeDescription> = {
  'app:read': {
    name: 'View your Kualia data',
    description: 'Read workspaces, accounts, budgets, transactions, and reports.',
    isWrite: false,
  },
  'budgets:write': {
    name: 'Change your budget',
    description: 'Create and update categories, targets, and assigned amounts.',
    isWrite: true,
  },
  'transactions:write': {
    name: 'Change transactions and accounts',
    description: 'Create, update, delete, and reconcile financial records.',
    isWrite: true,
  },
};

@Component({
  selector: 'app-oauth-authorize',
  imports: [NucleoIcon],
  template: `
    <div class="bg-muted/25 flex min-h-screen items-center justify-center p-4 sm:p-8">
      <main class="bg-card w-full max-w-[560px] overflow-hidden rounded-2xl border shadow-lg shadow-black/5">
        <div class="border-border/70 border-b px-5 py-5 sm:px-7">
          <div class="flex items-center gap-2.5">
            <img src="/images/kualiaAppIconOrange-min.png" alt="" class="h-8 w-8 rounded-lg" />
            <span class="font-medium tracking-tight">Kualia</span>
            <span class="text-muted-foreground ml-auto text-xs">Secure MCP authorization</span>
          </div>
        </div>

        <div class="p-5 sm:p-7">
          @if (errorMessage(); as error) {
            <div class="py-5 text-center">
              <div
                class="bg-destructive/10 text-destructive mx-auto flex h-12 w-12 items-center justify-center rounded-full"
              >
                <nucleo-icon [icon]="ShieldCheck" class="h-6 w-6" />
              </div>
              <h1 class="mt-4 text-xl font-semibold">This connection request is not valid</h1>
              <p class="text-muted-foreground mt-2 text-sm leading-6">{{ error }}</p>
            </div>
          } @else if (clientInfo(); as client) {
            <div class="text-center">
              <p class="text-muted-foreground text-sm">An external app wants access</p>
              <h1 class="mt-1 text-2xl font-semibold tracking-tight">
                Connect {{ client.clientName ?? 'this MCP client' }} to Kualia?
              </h1>

              <div class="mx-auto mt-6 flex max-w-sm items-center justify-center gap-3" aria-hidden="true">
                <div class="bg-muted flex h-14 w-14 items-center justify-center rounded-2xl border">
                  <nucleo-icon [icon]="Cable" class="text-muted-foreground h-6 w-6" />
                </div>
                <div class="text-muted-foreground flex min-w-20 items-center gap-2">
                  <div class="border-border h-px flex-1 border-t border-dashed"></div>
                  <nucleo-icon [icon]="ArrowRight" class="h-4 w-4" />
                  <div class="border-border h-px flex-1 border-t border-dashed"></div>
                </div>
                <img src="/images/kualiaAppIconOrange-min.png" alt="" class="h-14 w-14 rounded-2xl" />
              </div>
            </div>

            <section class="mt-7">
              <h2 class="text-sm font-medium">This connection will be able to:</h2>
              <div class="mt-3 space-y-2">
                @for (scope of requestedScopes(); track scope.name) {
                  <div class="bg-muted/35 flex gap-3 rounded-xl border p-3.5">
                    <div
                      class="bg-background text-primary mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border"
                    >
                      <nucleo-icon [icon]="Check" class="h-3.5 w-3.5" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <p class="text-sm font-medium">{{ scope.name }}</p>
                        @if (scope.isWrite) {
                          <span class="bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-full px-2 py-0.5 text-xs">
                            Can make changes
                          </span>
                        }
                      </div>
                      <p class="text-muted-foreground mt-0.5 text-sm leading-5">{{ scope.description }}</p>
                    </div>
                  </div>
                }
              </div>
            </section>

            <section class="bg-muted/25 mt-5 rounded-xl border px-4 py-3.5">
              <h2 class="text-sm font-medium">Connection details</h2>
              <dl class="mt-3 grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                <dt class="text-muted-foreground">App</dt>
                <dd class="truncate text-right font-medium" [title]="client.clientUri ?? client.clientId">
                  {{ clientDestination() }}
                </dd>
                <dt class="text-muted-foreground">Returns to</dt>
                <dd class="truncate text-right font-medium" [title]="client.redirectUri">{{ redirectDestination() }}</dd>
                @if (resourceDestination(); as resource) {
                  <dt class="text-muted-foreground">MCP server</dt>
                  <dd class="truncate text-right font-medium" [title]="client.resource">{{ resource }}</dd>
                }
              </dl>
            </section>

            <p class="text-muted-foreground mt-4 text-xs leading-5">
              Only approve this request if you started it. You can revoke the connection later from Account settings.
            </p>

            <div class="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                class="focus-visible:ring-ring rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                [disabled]="isSubmitting()"
                (click)="denyAuthorization()"
                data-testid="deny-oauth-authorization"
              >
                Deny
              </button>
              <button
                type="button"
                class="bg-primary text-primary-foreground focus-visible:ring-ring rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                [disabled]="isSubmitting()"
                (click)="approveAuthorization()"
                data-testid="approve-oauth-authorization"
              >
                {{ isSubmitting() ? 'Connecting…' : 'Approve' }}
              </button>
            </div>
          } @else {
            <div class="py-12 text-center">
              <div class="bg-muted mx-auto h-12 w-12 animate-pulse rounded-2xl"></div>
              <p class="text-muted-foreground mt-4 text-sm">Checking connection request…</p>
            </div>
          }
        </div>
      </main>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OauthAuthorizeComponent implements OnInit {
  protected readonly ArrowRight = ArrowRight;
  protected readonly Cable = Cable;
  protected readonly Check = Check;
  protected readonly ShieldCheck = ShieldCheck;

  private readonly route = inject(ActivatedRoute);
  private readonly convexService = inject(ConvexService);

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly clientInfo = signal<OAuthClientInfo | null>(null);
  protected readonly requestedScopes = signal<OAuthScopeDescription[]>([]);
  protected readonly isSubmitting = signal(false);
  protected readonly clientDestination = computed(() => {
    const client = this.clientInfo();
    return this.formatDestination(client?.clientUri ?? client?.redirectUri);
  });
  protected readonly redirectDestination = computed(() => this.formatDestination(this.clientInfo()?.redirectUri));
  protected readonly resourceDestination = computed(() => {
    const resource = this.clientInfo()?.resource;
    return resource ? this.formatDestination(resource) : null;
  });
  private authorizationParams: OAuthAuthorizeParams | null = null;

  ngOnInit(): void {
    void this.prepareAuthorization();
  }

  private async prepareAuthorization(): Promise<void> {
    const params = this.parseParams();
    if (!params) {
      return;
    }

    try {
      await this.waitForConvexAuthentication();

      const client = await this.convexService.getClient().query(api.mcp.getOauthAuthorizationClient, {
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        scope: params.scope,
        resource: params.resource,
      });
      this.authorizationParams = params;
      this.clientInfo.set(client);
      this.requestedScopes.set(this.describeScopes(client.scopes));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Authorization request is invalid';
      this.errorMessage.set(message);
    }
  }

  protected async approveAuthorization(): Promise<void> {
    const params = this.authorizationParams;
    if (!params || this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.convexService.mutation<{ code: string }>(api.mcp.createOauthAuthorizationCode, {
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        scope: params.scope,
        resource: params.resource,
        consent: 'approved',
      });

      const redirectUrl = new URL(params.redirectUri);
      redirectUrl.searchParams.set('code', result.code);
      if (params.state) {
        redirectUrl.searchParams.set('state', params.state);
      }

      this.redirectBrowser(redirectUrl.toString());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Authorization failed';
      this.errorMessage.set(message);
      this.isSubmitting.set(false);
    }
  }

  protected denyAuthorization(): void {
    const params = this.authorizationParams;
    if (!params || this.isSubmitting()) {
      return;
    }

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set('error', 'access_denied');
    redirectUrl.searchParams.set('error_description', 'The resource owner denied the authorization request.');
    if (params.state) {
      redirectUrl.searchParams.set('state', params.state);
    }

    this.redirectBrowser(redirectUrl.toString());
  }

  private describeScopes(scopes: string[]): OAuthScopeDescription[] {
    return scopes.map(
      (item) =>
        OAUTH_SCOPE_DESCRIPTIONS[item] ?? {
          name: item,
          description: 'Access requested by this application.',
          isWrite: true,
        }
    );
  }

  private formatDestination(value: string | undefined): string {
    if (!value) {
      return 'Not provided';
    }

    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.host;
      }
      return `${url.protocol}//${url.host || url.pathname.split('/')[0]}`;
    } catch {
      return value;
    }
  }

  private async waitForConvexAuthentication(): Promise<void> {
    const startTime = Date.now();

    while (!this.convexService.isAuthenticated()) {
      if (Date.now() - startTime > MAX_CONVEX_AUTH_WAIT_MS) {
        throw new Error('Authentication session is not ready. Please try again.');
      }

      await new Promise((resolve) => setTimeout(resolve, CONVEX_AUTH_CHECK_INTERVAL_MS));
    }
  }

  private parseParams(): OAuthAuthorizeParams | null {
    const query = this.route.snapshot.queryParamMap;

    const responseType = query.get('response_type');
    const clientId = query.get('client_id');
    const redirectUri = query.get('redirect_uri');
    const codeChallenge = query.get('code_challenge');
    const codeChallengeMethod = query.get('code_challenge_method');

    if (responseType !== 'code') {
      this.errorMessage.set('response_type must be code');
      return null;
    }

    if (!clientId) {
      this.errorMessage.set('client_id is required');
      return null;
    }

    if (!redirectUri) {
      this.errorMessage.set('Missing redirect_uri');
      return null;
    }

    if (!codeChallenge) {
      this.errorMessage.set('code_challenge is required');
      return null;
    }

    if (!codeChallengeMethod) {
      this.errorMessage.set('code_challenge_method is required');
      return null;
    }

    return {
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope: query.get('scope') ?? undefined,
      state: query.get('state') ?? undefined,
      resource: query.get('resource') ?? undefined,
    };
  }

  protected redirectBrowser(url: string): void {
    window.location.assign(url);
  }
}
