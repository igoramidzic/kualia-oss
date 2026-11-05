import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from './convex.service';
import { YnabImportService } from './ynab-import.service';

describe('YnabImportService', () => {
  let service: YnabImportService;

  const mockConvexService = {
    isAuthenticated: vi.fn<() => boolean>(() => false),
    watchQuery: vi.fn(() => ({
      subscribe: vi.fn(() => vi.fn()),
    })),
    action: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 19, 15, 30, 0)); // 2026-02-19 local
    vi.clearAllMocks();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        YnabImportService,
        { provide: ConvexService, useValue: mockConvexService },
      ],
    });

    service = TestBed.inject(YnabImportService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes local currentDate when starting import', async () => {
    service.setPlanCsv('Month,Category Group/Category,Category Group,Category,Assigned,Activity,Available\n');
    service.setRegisterCsv(
      'Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared\n'
    );

    mockConvexService.action
      .mockResolvedValueOnce({
        success: true,
        accountMappings: [
          {
            accountName: 'Checking',
            inferredType: 'banking_checking',
            confirmedType: 'banking_checking',
          },
        ],
        preview: {
          accountCount: 1,
          monthCount: 0,
          categoryCount: 0,
          transactionCount: 0,
        },
      })
      .mockResolvedValueOnce({ success: true });

    const parseSuccess = await service.parseFiles();
    expect(parseSuccess).toBe(true);

    const importSuccess = await service.startImport();
    expect(importSuccess).toBe(true);

    const startImportArgs = mockConvexService.action.mock.calls[1]?.[1] as { currentDate?: string };
    expect(startImportArgs.currentDate).toBe('2026-02-19');
  });

  it('passes selected currency when parsing and starting import', async () => {
    service.setPlanCsv('Month,Category Group/Category,Category Group,Category,Assigned,Activity,Available\n');
    service.setRegisterCsv(
      'Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared\n'
    );
    service.setCurrency('JPY');

    mockConvexService.action
      .mockResolvedValueOnce({
        success: true,
        accountMappings: [
          {
            accountName: 'Checking',
            inferredType: 'banking_checking',
            confirmedType: 'banking_checking',
          },
        ],
        preview: {
          accountCount: 1,
          monthCount: 0,
          categoryCount: 0,
          transactionCount: 0,
        },
      })
      .mockResolvedValueOnce({ success: true });

    const parseSuccess = await service.parseFiles();
    expect(parseSuccess).toBe(true);

    const parseArgs = mockConvexService.action.mock.calls[0]?.[1] as { currency?: string };
    expect(parseArgs.currency).toBe('JPY');

    const importSuccess = await service.startImport();
    expect(importSuccess).toBe(true);

    const startImportArgs = mockConvexService.action.mock.calls[1]?.[1] as { currency?: string };
    expect(startImportArgs.currency).toBe('JPY');
  });

  it('normalizes dashed day-first dates before parse and import actions', async () => {
    service.setPlanCsv('Month,Category Group/Category,Category Group,Category,Assigned,Activity,Available\n');
    service.setRegisterCsv(
      [
        '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
        '"Checking","","13-02-2026","Coffee Shop","Everyday: Coffee","Everyday","Coffee","",$5.00,$0.00,"Cleared"',
      ].join('\r\n')
    );

    mockConvexService.action
      .mockResolvedValueOnce({
        success: true,
        accountMappings: [
          {
            accountName: 'Checking',
            inferredType: 'banking_checking',
            confirmedType: 'banking_checking',
          },
        ],
        preview: {
          accountCount: 1,
          monthCount: 0,
          categoryCount: 0,
          transactionCount: 1,
        },
      })
      .mockResolvedValueOnce({ success: true });

    const parseSuccess = await service.parseFiles();
    expect(parseSuccess).toBe(true);

    const parseArgs = mockConvexService.action.mock.calls[0]?.[1] as { registerCsvContent?: string };
    expect(parseArgs.registerCsvContent).toContain('"13/02/2026"');

    const importSuccess = await service.startImport();
    expect(importSuccess).toBe(true);

    const startImportArgs = mockConvexService.action.mock.calls[1]?.[1] as { registerCsvContent?: string };
    expect(startImportArgs.registerCsvContent).toContain('"13/02/2026"');
  });
});
