import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MK AI Travel", short_name: "MK Travel", description: "Thoughtful travel planning by MK Solutions.",
    start_url: "/", display: "standalone", background_color: "#f7f7f4", theme_color: "#173d35",
    icons: [],
  };
}
