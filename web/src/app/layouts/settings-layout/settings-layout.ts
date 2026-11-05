import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterOutlet } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar';
import {
  nucleoArrowLeft as ArrowLeft,
  nucleoWorkspace as Building,
  nucleoConnection as Cable,
  nucleoChevronsRight as ChevronsRight,
  nucleoCreditCard as CreditCard,
  nucleoDownload as Download,
  nucleoHistory as History,
  nucleoKey as KeyRound,
  nucleoLink as Link,
  NucleoIcon,
  nucleoPreferences as Settings,
  nucleoShop as Store,
  nucleoUser as UserRound,
  nucleoUsers as UsersRound,
} from '@kualia/icons';
import { NavigationItemComponent } from '../../components/navigation-item/navigation-item';
import { WorkspaceService } from '../../services/workspace.service';

@Component({
  selector: 'app-settings-layout',
  imports: [RouterOutlet, RouterLink, HlmButton, NucleoIcon, NavigationItemComponent, ...HlmSidebarImports],
  templateUrl: './settings-layout.html',
  styleUrl: './settings-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsLayoutComponent implements OnInit {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly route = inject(ActivatedRoute);

  protected readonly isAccountSettings = this.route.snapshot.data['settingsScope'] === 'account';

  protected readonly ArrowLeft = ArrowLeft;
  protected readonly Settings = Settings;
  protected readonly Building = Building;
  protected readonly Cable = Cable;
  protected readonly Link = Link;
  protected readonly ChevronsRight = ChevronsRight;
  protected readonly Store = Store;
  protected readonly CreditCard = CreditCard;
  protected readonly Download = Download;
  protected readonly History = History;
  protected readonly UserRound = UserRound;
  protected readonly UsersRound = UsersRound;
  protected readonly KeyRound = KeyRound;

  private buildRoute(path: string): string {
    const shortId = this.workspaceService.workspaceShortId();
    return shortId ? `/${shortId}${path}` : path;
  }

  protected readonly backRoute = computed(() => (this.isAccountSettings ? '/' : this.buildRoute('')));
  protected readonly profileRoute = '/settings/profile';
  protected readonly preferencesRoute = '/settings/preferences';
  protected readonly workspaceSettingsRoute = computed(() => this.buildRoute('/settings/general'));
  protected readonly exportRoute = computed(() => this.buildRoute('/settings/export'));
  protected readonly familyRoute = '/settings/family';
  protected readonly bankConnectionsRoute = computed(() => this.buildRoute('/settings/bank-connections'));
  protected readonly activityRoute = computed(() => this.buildRoute('/settings/activity'));
  protected readonly merchantsRoute = computed(() => this.buildRoute('/settings/merchants'));
  protected readonly rulesRoute = computed(() => this.buildRoute('/settings/rules'));
  protected readonly billingRoute = '/settings/billing';
  protected readonly apiKeysRoute = '/settings/api-keys';
  protected readonly mcpConnectionsRoute = '/settings/mcp-connections';

  ngOnInit(): void {
    if (!this.isAccountSettings) {
      // Load Plaid script for bank connection functionality.
      this.loadPlaidScript();
    }
  }

  private loadPlaidScript(): void {
    // Check if script already exists
    if (document.getElementById('plaid-script')) {
      return;
    }

    // Create and append the Plaid script
    const script = document.createElement('script');
    script.id = 'plaid-script';
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.async = true;
    document.head.appendChild(script);
  }
}
