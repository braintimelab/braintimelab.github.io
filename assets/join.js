(() => {
  const page = document.querySelector('.join-page');
  if (!page) return;
  const motion = page.querySelector('.motion-control');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const slider = page.querySelector('#elapsed-days');
  const output = page.querySelector('#elapsed-label');
  const summary = page.querySelector('#phase-summary');
  const play = page.querySelector('#rhythm-play');
  const reset = page.querySelector('#rhythm-reset');
  const clocks = [...page.querySelectorAll('[data-clock]')];
  const periods = {slow:25,reference:24,fast:23};
  let paused = reduced.matches;
  let playing = false;
  let frame = 0;
  function render(days) {
    const hours = days * 24;
    clocks.forEach(clock => clock.setAttribute('transform', `rotate(${hours / periods[clock.dataset.clock] * 360} 80 80)`));
    output.value = `${Number(days.toFixed(1))} ${days === 1 ? 'day' : 'days'}`;
    summary.textContent = days === 0 ? 'All three clocks start at the same phase.' : `At ${Number(days.toFixed(1))} days, the slower clock lags by ${(hours-hours*24/25).toFixed(1)} hours; the faster clock leads by ${(hours*24/23-hours).toFixed(1)} hours relative to the daily reference.`;
  }
  function stop() {
    playing = false;
    cancelAnimationFrame(frame);
    play.textContent = '▶ Play';
    play.setAttribute('aria-pressed', 'false');
  }
  function updateMotion() {
    page.classList.toggle('motion-paused', paused);
    page.classList.toggle('motion-enabled', !paused);
    motion.textContent = paused ? 'Play motion' : 'Pause motion';
    motion.setAttribute('aria-pressed', String(paused));
    if (paused) stop();
  }
  function tick(time) {
    if (!playing) return;
    // A separate numeric value avoids range-step rounding at every animation frame.
    animateDays = Math.min(10, animateDays + Math.min(time-previousTime,100)/4000);
    previousTime = time;
    slider.value = String(animateDays);
    render(animateDays);
    if (animateDays >= 10) stop();
    else frame = requestAnimationFrame(tick);
  }
  let animateDays = 0;
  let previousTime = 0;
  motion.hidden = false;
  page.querySelector('.rhythm-controls').hidden = false;
  updateMotion();
  render(0);
  motion.addEventListener('click', () => { paused = !paused; updateMotion(); });
  reduced.addEventListener('change', event => { paused = event.matches; updateMotion(); });
  slider.addEventListener('input', () => { stop(); render(Number(slider.value)); });
  play.addEventListener('click', () => {
    if (playing) return stop();
    if (Number(slider.value) >= 10) slider.value = '0';
    animateDays = Number(slider.value);
    previousTime = performance.now();
    playing = true;
    play.textContent = 'Ⅱ Pause';
    play.setAttribute('aria-pressed', 'true');
    frame = requestAnimationFrame(tick);
  });
  reset.addEventListener('click', () => { stop(); slider.value = '0'; render(0); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
