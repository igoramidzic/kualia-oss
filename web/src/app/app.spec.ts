import { describe, expect, it } from 'vitest';
import appTemplate from './app.html?raw';

describe('App loading state', () => {
  it('renders every route inside one persistent application layout', () => {
    expect(appTemplate).toContain(
      '<app-main-layout [shellEnabled]="usesMainLayout()" [settingsShellEnabled]="usesSettingsLayout()">'
    );
    expect(appTemplate).toContain('<router-outlet />');
    expect(appTemplate.indexOf('<app-main-layout')).toBeLessThan(appTemplate.indexOf('<router-outlet />'));
    expect(appTemplate.indexOf('<router-outlet />')).toBeLessThan(appTemplate.indexOf('</app-main-layout>'));
  });

  it('does not mount a separate bootstrap shell over the routed layout', () => {
    expect(appTemplate).not.toContain('fixed inset-0 z-40');
    expect(appTemplate).not.toContain('showBootstrapShell');
    expect(appTemplate).not.toContain('<hlm-sidebar');
  });
});
