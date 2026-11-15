import { getMenuItems } from "@/lib/catalog";
import { MenuGuide } from "@/components/MenuGuide";
import { BRAND_SETTINGS } from "@/lib/settings";

export const dynamic = "force-dynamic";
export default async function MenuGuidePage() {
  const items = (await getMenuItems()).filter((item) => item.available).map(({ slug, name, isVeg, spiceLevels, categoryName }) => ({ slug, name, isVeg, spiceLevels, categoryName }));
  return <MenuGuide items={items} phone={BRAND_SETTINGS.restaurant_phone} />;
}
