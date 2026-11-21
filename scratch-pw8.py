p = "prisma/schema.prisma"
s = open(p, encoding="utf8").read()
a = "  totpEnabled Boolean @default(false)\n"
assert a in s
s = s.replace(a, a + "  /// True while the user is on a temporary password an administrator gave them.\n  mustChangePassword Boolean @default(false)\n", 1)
open(p, "w", encoding="utf8").write(s)
print("ok")
