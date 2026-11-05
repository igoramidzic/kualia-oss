import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { nucleoShop as Store } from '@kualia/icons';
import { describe, expect, it, vi } from 'vitest';
import { IconService } from '../../services/icon.service';
import { LogoSearchService } from '../../services/logo-search.service';
import { LogoUploadService, UploadProgress } from '../../services/logo-upload.service';
import { VisualIdentityMode } from '../../shared/utils/entity-identity';
import { LogoPickerComponent } from './logo-picker.component';

describe('LogoPickerComponent', () => {
  function createComponent() {
    const uploadProgress = signal<UploadProgress>({ status: 'idle', progress: 0 });
    const mockLogoSearchService: Pick<LogoSearchService, 'searchLogos'> = {
      searchLogos: vi.fn<LogoSearchService['searchLogos']>().mockResolvedValue([]),
    };
    const mockLogoUploadService: Pick<
      LogoUploadService,
      'uploadProgress' | 'resetProgress' | 'validateFile' | 'uploadLogo'
    > = {
      uploadProgress: uploadProgress.asReadonly(),
      resetProgress: vi.fn(),
      validateFile: vi.fn<LogoUploadService['validateFile']>(() => ({ valid: true })),
      uploadLogo: vi.fn<LogoUploadService['uploadLogo']>().mockResolvedValue('https://example.com/logo.png'),
    };
    const filteredIcons = signal<string[]>(['Store']);
    const mockIconService: Pick<IconService, 'filteredIcons' | 'setSearchQuery' | 'getIconByName'> = {
      filteredIcons: filteredIcons.asReadonly(),
      setSearchQuery: vi.fn(),
      getIconByName: vi.fn<IconService['getIconByName']>(() => Store),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LogoPickerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: LogoSearchService, useValue: mockLogoSearchService },
        { provide: LogoUploadService, useValue: mockLogoUploadService },
        { provide: IconService, useValue: mockIconService },
      ],
    });

    const fixture = TestBed.createComponent(LogoPickerComponent);
    const component = fixture.componentInstance;
    const emittedModes: VisualIdentityMode[] = [];
    component.modeChange.subscribe((mode) => emittedModes.push(mode));

    return { component, emittedModes };
  }

  it('does not emit mode changes when the activated tab is already active', () => {
    const { component, emittedModes } = createComponent();
    component.activeMode.set('logo');

    component.onTabActivated('logo');

    expect(emittedModes).toEqual([]);
    expect(component.activeMode()).toBe('logo');
  });

  it('emits mode changes when the activated tab changes the active mode', () => {
    const { component, emittedModes } = createComponent();
    component.activeMode.set('logo');

    component.onTabActivated('icon');

    expect(emittedModes).toEqual(['icon']);
    expect(component.activeMode()).toBe('icon');
  });
});
