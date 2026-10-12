import { withAuth } from "next-auth/middleware";

// 页面级路由守卫：/teacher 仅教师/管理员，/student 仅学生
export default withAuth({
  pages: { signIn: "/login" },
  callbacks: {
    authorized: ({ req, token }) => {
      const path = req.nextUrl.pathname;
      if (path.startsWith("/teacher")) return token?.role === "TEACHER" || token?.role === "ADMIN";
      if (path.startsWith("/student")) return token?.role === "STUDENT";
      return false;
    },
  },
});

export const config = {
  matcher: ["/teacher/:path*", "/student/:path*"],
};
