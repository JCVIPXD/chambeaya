enum AppLayoutClass { mobile, tablet, desktop }

AppLayoutClass classifyLayout(double width) {
  if (width < 600) return AppLayoutClass.mobile;
  if (width < 1024) return AppLayoutClass.tablet;
  return AppLayoutClass.desktop;
}
