import { Directive, ElementRef, inject, input, OnDestroy, OnInit } from '@angular/core';

@Directive({
  selector: '[appFadeInView]',
})
export class FadeInViewDirective implements OnInit, OnDestroy {
  private readonly element = inject(ElementRef);
  private observer: IntersectionObserver | null = null;

  delay = input<number>(0);
  threshold = input<number>(0.1);
  once = input<boolean>(true);

  ngOnInit(): void {
    const nativeElement = this.element.nativeElement as HTMLElement;

    nativeElement.style.opacity = '0';
    nativeElement.style.transform = 'translateY(20px)';
    nativeElement.style.transition = `opacity 0.6s ease-out ${this.delay()}ms, transform 0.6s ease-out ${this.delay()}ms`;

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            nativeElement.style.opacity = '1';
            nativeElement.style.transform = 'translateY(0)';

            if (this.once()) {
              this.observer?.unobserve(nativeElement);
            }
          } else if (!this.once()) {
            nativeElement.style.opacity = '0';
            nativeElement.style.transform = 'translateY(20px)';
          }
        });
      },
      {
        threshold: this.threshold(),
      }
    );

    this.observer.observe(nativeElement);
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
