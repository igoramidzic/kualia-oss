import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { api } from 'convex/_generated/api';
import { describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../services/convex.service';
import { OauthAuthorizeComponent } from './oauth-authorize.component';

describe('OauthAuthorizeComponent', () => {
  let fixture: ComponentFixture<OauthAuthorizeComponent>;
  let component: OauthAuthorizeComponent;

  let mockConvexService: {
    getClient: ReturnType<typeof vi.fn>;
    mutation: ReturnType<typeof vi.fn>;
    isAuthenticated: ReturnType<typeof vi.fn>;
  };
  let queryMock: ReturnType<typeof vi.fn>;

  const createComponent = async (query: Record<string, string>) => {
    const scopes = (query['scope'] ?? 'app:read')
      .split(/\s+/)
      .map((scope) => (scope === 'reports:read' ? 'app:read' : scope));
    queryMock = vi.fn().mockResolvedValue({
      clientId: 'claude',
      clientName: 'Claude',
      clientUri: 'https://claude.ai',
      redirectUri: query['redirect_uri'] ?? 'http://localhost:9000/callback',
      scopes,
      resource: query['resource'],
    });
    mockConvexService = {
      getClient: vi.fn().mockReturnValue({ query: queryMock }),
      mutation: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [OauthAuthorizeComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: mockConvexService },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(query),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OauthAuthorizeComponent);
    component = fixture.componentInstance;
  };

  it('loads client details without creating an authorization code', async () => {
    await createComponent({
      response_type: 'code',
      client_id: 'claude',
      redirect_uri: 'http://localhost:9000/callback',
      code_challenge: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      code_challenge_method: 'S256',
      scope: 'reports:read',
      state: 'xyz123',
    });

    await component['prepareAuthorization']();

    expect(queryMock).toHaveBeenCalledWith(api.mcp.getOauthAuthorizationClient, {
      clientId: 'claude',
      redirectUri: 'http://localhost:9000/callback',
      scope: 'reports:read',
      resource: undefined,
    });
    expect(mockConvexService.mutation).not.toHaveBeenCalled();
    expect(component['clientInfo']()).toEqual({
      clientId: 'claude',
      clientName: 'Claude',
      clientUri: 'https://claude.ai',
      redirectUri: 'http://localhost:9000/callback',
      scopes: ['app:read'],
      resource: undefined,
    });
  });

  it('shows the app destination, return address, MCP server, and requested access', async () => {
    await createComponent({
      response_type: 'code',
      client_id: 'claude',
      redirect_uri: 'http://localhost:9000/callback',
      code_challenge: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      code_challenge_method: 'S256',
      scope: 'app:read transactions:write',
      resource: 'https://api.kualia.com/mcp',
    });

    await component['prepareAuthorization']();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Connect Claude to Kualia?');
    expect(text).toContain('claude.ai');
    expect(text).toContain('localhost:9000');
    expect(text).toContain('api.kualia.com');
    expect(text).toContain('View your Kualia data');
    expect(text).toContain('Change transactions and accounts');
    expect(fixture.nativeElement.querySelector('[data-testid="approve-oauth-authorization"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="deny-oauth-authorization"]')).not.toBeNull();
  });

  it('creates an authorization code only after explicit approval', async () => {
    await createComponent({
      response_type: 'code',
      client_id: 'claude',
      redirect_uri: 'http://localhost:9000/callback',
      code_challenge: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      code_challenge_method: 'S256',
      scope: 'reports:read transactions:write',
      state: 'xyz123',
    });

    mockConvexService.mutation.mockResolvedValue({ code: 'kualia_oac_code' });
    const redirectSpy = vi.spyOn(component as unknown as { redirectBrowser: (url: string) => void }, 'redirectBrowser');

    await component['prepareAuthorization']();
    expect(mockConvexService.mutation).not.toHaveBeenCalled();

    await component['approveAuthorization']();

    expect(mockConvexService.mutation).toHaveBeenCalledWith(api.mcp.createOauthAuthorizationCode, {
      clientId: 'claude',
      redirectUri: 'http://localhost:9000/callback',
      codeChallenge: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      codeChallengeMethod: 'S256',
      scope: 'reports:read transactions:write',
      resource: undefined,
      consent: 'approved',
    });

    expect(redirectSpy).toHaveBeenCalledTimes(1);
    const redirectUrl = new URL(redirectSpy.mock.calls[0][0]);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe('http://localhost:9000/callback');
    expect(redirectUrl.searchParams.get('code')).toBe('kualia_oac_code');
    expect(redirectUrl.searchParams.get('state')).toBe('xyz123');
  });

  it('redirects with access_denied without creating a code', async () => {
    await createComponent({
      response_type: 'code',
      client_id: 'claude',
      redirect_uri: 'http://localhost:9000/callback',
      code_challenge: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      code_challenge_method: 'S256',
      state: 'xyz123',
    });

    const redirectSpy = vi.spyOn(component as unknown as { redirectBrowser: (url: string) => void }, 'redirectBrowser');
    await component['prepareAuthorization']();

    component['denyAuthorization']();

    expect(mockConvexService.mutation).not.toHaveBeenCalled();
    const redirectUrl = new URL(redirectSpy.mock.calls[0][0]);
    expect(redirectUrl.searchParams.get('error')).toBe('access_denied');
    expect(redirectUrl.searchParams.get('state')).toBe('xyz123');
  });

  it('does not redirect when required params are missing', async () => {
    await createComponent({
      response_type: 'code',
      redirect_uri: 'http://localhost:9000/callback',
      code_challenge: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      code_challenge_method: 'S256',
    });

    const redirectSpy = vi.spyOn(component as unknown as { redirectBrowser: (url: string) => void }, 'redirectBrowser');

    await component['prepareAuthorization']();

    expect(mockConvexService.mutation).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
    expect(component['errorMessage']()).toBe('client_id is required');
  });

  it('does not redirect when authorization code creation fails after approval', async () => {
    await createComponent({
      response_type: 'code',
      client_id: 'claude',
      redirect_uri: 'http://localhost:9000/callback',
      code_challenge: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      code_challenge_method: 'S256',
      state: 'xyz123',
    });

    mockConvexService.mutation.mockRejectedValue(new Error('OAuth client is not registered'));
    const redirectSpy = vi.spyOn(component as unknown as { redirectBrowser: (url: string) => void }, 'redirectBrowser');

    await component['prepareAuthorization']();
    await component['approveAuthorization']();

    expect(redirectSpy).not.toHaveBeenCalled();
    expect(component['errorMessage']()).toBe('OAuth client is not registered');
  });
});
