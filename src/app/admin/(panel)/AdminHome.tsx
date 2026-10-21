"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingBlock } from "@/components/admin";
import { firstAccessiblePath } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";

export function AdminHome() {
  const router = useRouter();
  const { me } = useAdminSession();
  const target = firstAccessiblePath(me.permissions);

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return <LoadingBlock lines={3} />;
}
