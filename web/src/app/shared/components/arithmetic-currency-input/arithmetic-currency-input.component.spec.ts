import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrencyService } from '../../../services/currency.service';
import { ArithmeticCurrencyInputComponent } from './arithmetic-currency-input.component';

describe('ArithmeticCurrencyInputComponent', () => {
  let component: ArithmeticCurrencyInputComponent;
  let fixture: ComponentFixture<ArithmeticCurrencyInputComponent>;
  let input: HTMLInputElement;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [ArithmeticCurrencyInputComponent],
      providers: [
        {
          provide: CurrencyService,
          useValue: {
            currencyCode: signal('USD'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArithmeticCurrencyInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
  });

  it('should prevent text characters from being typed', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('should allow supported arithmetic expression characters', () => {
    for (const key of ['1', '.', '+', '-', '*', '/', '(', ')', ' ']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });

      input.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('should sanitize unsupported characters from pasted input', () => {
    input.value = '12abc + (3*4) dollars';

    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.getInputText()).toBe('12 + (3*4) ');
    expect(input.value).toBe('12 + (3*4) ');
  });
});
