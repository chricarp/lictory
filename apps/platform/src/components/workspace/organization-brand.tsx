import { useEffect } from "react";
import { brandPalette } from "@lictory/core/branding/color";

type Branded = {
  logos: { mark: string | null; icon?: string | null };
  brandColor?: string | null;
};

const brandProperties = [
  "--org-brand-light",
  "--org-brand-light-foreground",
  "--org-brand-dark",
  "--org-brand-dark-foreground",
] as const;

// Publishes a brand color to the stylesheet, which tints the default theme
// with it (packages/ui/src/styles.css). Returns the undo.
export function applyBrandColor(color: string) {
  const root = document.documentElement;
  const { light, dark } = brandPalette(color);
  const values = [light.color, light.foreground, dark.color, dark.foreground];
  brandProperties.forEach((name, i) =>
    root.style.setProperty(name, values[i]!),
  );
  root.dataset.brand = "";
  return () => {
    delete root.dataset.brand;
    for (const name of brandProperties) root.style.removeProperty(name);
  };
}

// While people work in an organization, the application wears its brand: the
// browser tab shows its icon (or its logomark) and the default theme takes
// its color. Leaving the organization returns both to Lictory's. A person's
// own colour theme, when they chose one, is theirs and stays untouched.
export function OrganizationBrand({ organization }: { organization: Branded }) {
  const icon = organization.logos.icon ?? organization.logos.mark;
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link || !icon) return;
    const original = { href: link.getAttribute("href"), type: link.type };
    link.removeAttribute("type");
    link.href = icon;
    return () => {
      if (original.type) link.type = original.type;
      if (original.href) link.href = original.href;
    };
  }, [icon]);

  const color = organization.brandColor ?? null;
  useEffect(() => (color ? applyBrandColor(color) : undefined), [color]);
  return null;
}
