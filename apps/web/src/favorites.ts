import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Property } from "./api";
import { useAuth } from "./auth";

export function useFavorites() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (user)
      api<string[]>("/favorites")
        .then(setIds)
        .catch((e) => setError(e.message));
    else setIds([]);
  }, [user]);
  async function toggle(p: Property) {
    if (!user) {
      navigate("/login");
      return;
    }
    if (p.id.startsWith("preview")) {
      setError(
        "This is a sample listing. You can save live properties once agents publish them.",
      );
      return;
    }
    try {
      const exists = ids.includes(p.id);
      await api(`/favorites/${p.id}`, { method: exists ? "DELETE" : "PUT" });
      setIds((old) =>
        exists ? old.filter((id) => id !== p.id) : [...old, p.id],
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return { ids, toggle, error };
}
