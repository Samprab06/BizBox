import { redirect } from "next/navigation";

/** The client now uses real inventory; the retired sample review is not a product entry. */
export default function Page() {
  redirect("/projects/houston-coffee/workspace");
}
