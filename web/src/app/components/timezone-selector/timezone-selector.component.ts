import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { nucleoGlobe as Globe, NucleoIcon } from '@kualia/icons';
import { getAllTimezones, getTimezoneInfo, TimezoneInfo } from '../../shared/utils/timezone-info';

@Component({
  selector: 'app-timezone-selector',
  imports: [NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      [value]="selectedTimezone()"
      (valueChange)="selectTimezone($event)"
      [disabled]="disabled()"
      [filter]="filterTimezone"
      [itemToString]="timezoneToString"
      sideOffset="5"
      autoFocus="first-tabbable"
    >
      <hlm-combobox-trigger class="w-full max-w-full min-w-0 justify-between font-normal">
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <nucleo-icon [icon]="Globe" [size]="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ timezoneToString(selectedTimezone()) }}</span>
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="w-[320px] **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border border-b">
          <hlm-combobox-input placeholder="Search timezones..." [showTrigger]="false" />
        </div>
        <div hlmComboboxList>
          <div hlmComboboxGroup>
            @for (timezone of allTimezones(); track timezone.id) {
              <hlm-combobox-item [value]="timezone.id">
                <div class="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span class="min-w-0 truncate">{{ timezone.city }}</span>
                  <span class="text-muted-foreground shrink-0 text-xs">{{ timezone.offset }}</span>
                </div>
              </hlm-combobox-item>
            }
          </div>
        </div>
        <hlm-combobox-empty>No timezones found.</hlm-combobox-empty>
      </div>
    </hlm-combobox>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        max-width: 100%;
      }
    `,
  ],
})
export class TimezoneSelectorComponent {
  // Inputs
  readonly selectedTimezone = input<string>('America/New_York');
  readonly disabled = input<boolean>(false);

  // Outputs
  readonly timezoneChange = output<string>();

  // Icons
  readonly Globe = Globe;

  // All timezones, keeping the current one even if this browser doesn't list it
  readonly allTimezones = computed((): TimezoneInfo[] => {
    const timezones = getAllTimezones();
    const selected = this.selectedTimezone();
    if (timezones.some((timezone) => timezone.id === selected)) {
      return timezones;
    }
    const selectedInfo = getTimezoneInfo(selected);
    return selectedInfo ? [selectedInfo, ...timezones] : timezones;
  });

  // Filter function for combobox
  filterTimezone = (id: string, search: string): boolean => {
    const timezone = getTimezoneInfo(id);
    if (!timezone) return false;
    const searchLower = search.toLowerCase();
    return timezone.searchText.includes(searchLower);
  };

  // Convert timezone id to display string
  timezoneToString = (id: string): string => {
    const timezone = getTimezoneInfo(id);
    return timezone ? `${timezone.city} (${timezone.offset})` : id;
  };

  selectTimezone(timezoneId: string | null | undefined) {
    if (this.disabled()) {
      return;
    }

    if (timezoneId) {
      this.timezoneChange.emit(timezoneId);
    }
  }
}
