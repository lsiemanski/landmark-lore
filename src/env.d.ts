declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}

declare module "*.yaml" {
  const data: Record<string, string>;
  export default data;
}
