const items: { href: string; icon: string; label: string }[] = [
  { href: "#/automations", icon: "↻", label: "Automations" },
  { href: "#/envs", icon: "⌂", label: "Environments" },
  { href: "#/disk", icon: "▥", label: "Disk" },
  { href: "#/settings", icon: "⚙", label: "Settings" },
];

export function More() {
  return (
    <main className="screen mh-phone">
      <div className="ptop">
        <h1>More</h1>
      </div>
      <ul className="more-list" aria-label="More">
        {items.map((i) => (
          <li key={i.href}>
            <a className="more-row" href={i.href}>
              <span className="ico" aria-hidden="true">
                {i.icon}
              </span>
              <span className="nm">{i.label}</span>
              <span className="chev" aria-hidden="true">
                ›
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
