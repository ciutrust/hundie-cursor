import { redirect } from "next/navigation";

export default function UnclassifiedRedirectPage() {
  redirect("/review/entities");
}
