import { z } from "zod";

export const booleanLike = z.preprocess((value) => {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    return value;
}, z.boolean());
