export function timeTheme() {
  const hour = new Date().getHours();
  return hour < 6 || hour >= 18;
}

export function watchTimeTheme(onChange: (dark: boolean) => void) {
  let timer: ReturnType<typeof setTimeout>;
  const update = () => {
    clearTimeout(timer);
    onChange(timeTheme());
    const now = new Date();
    const next = new Date(now);
    const hour = now.getHours();
    next.setHours(hour < 6 ? 6 : hour < 18 ? 18 : 30, 0, 0, 0);
    timer = setTimeout(update, next.getTime() - now.getTime());
  };
  update();
  window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", update);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", update);
    document.removeEventListener("visibilitychange", update);
  };
}
