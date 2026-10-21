'use client';
import React from "react";
import type { A11yProps, AssetUrl } from "@almadar/core";
import { domPassthrough } from '../../../core';
import { Outlet, Link } from "react-router-dom";
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { VStack } from '../../../core';
import { Typography } from '../../../core';

export interface AuthLayoutProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** App name */
  appName?: string;
  /** Logo component or URL */
  logo?: React.ReactNode;
  /** Background image URL */
  backgroundImage?: AssetUrl;
  /** Show branding panel on the side */
  showBranding?: boolean;
  /** Branding panel content */
  brandingContent?: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  appName: appNameProp,
  logo,
  backgroundImage,
  showBranding = true,
  brandingContent,
  ...rest
}) => {
  const { t } = useTranslate();
  const appName = appNameProp ?? t("auth.defaultAppName");

  return (
    <Box {...domPassthrough(rest)} className="min-h-screen flex">
      {/* Branding panel (desktop only) */}
      {showBranding && (
        <VStack
          className={cn(
            "hidden lg:flex lg:w-1/2 bg-primary relative overflow-hidden",
            "justify-between p-12",
          )}
          style={
            backgroundImage
              ? {
                  backgroundImage: `url(${backgroundImage})`,
                  backgroundSize: "cover",
                }
              : undefined
          }
          gap="none"
        >
          {/* Gradient overlay */}
          <Box className="absolute inset-0 bg-gradient-to-br from-primary/90 to-primary-hover/90" />

          {/* Content */}
          <Box className="relative z-10">
            <Link to="/" className="flex items-center gap-3">
              {logo || (
                <Box className="w-10 h-10 bg-primary-foreground/20 rounded-container flex items-center justify-center backdrop-blur">
                  <Typography
                    variant="body1"
                    className="text-primary-foreground font-bold text-lg"
                  >
                    {appName.charAt(0).toUpperCase()}
                  </Typography>
                </Box>
              )}
              <Typography
                variant="body1"
                className="text-2xl font-bold text-primary-foreground"
              >
                {appName}
              </Typography>
            </Link>
          </Box>

          {/* Custom branding content or default */}
          <Box className="relative z-10">
            {brandingContent || (
              <VStack gap="lg">
                <Typography
                  variant="h1"
                  className="text-4xl text-primary-foreground leading-tight"
                >
                  {t("auth.welcomeTo", { appName })}
                </Typography>
                <Typography
                  variant="body1"
                  className="text-lg text-primary-foreground/80 max-w-md"
                >
                  {t("auth.brandingSubtitle")}
                </Typography>
              </VStack>
            )}
          </Box>

          {/* Decorative elements */}
          <Box className="absolute -bottom-32 -right-32 w-96 h-96 bg-primary-foreground/5 rounded-full" />
          <Box className="absolute -top-16 -right-16 w-64 h-64 bg-primary-foreground/5 rounded-full" />
        </VStack>
      )}

      {/* Auth form panel */}
      <Box
        className={cn(
          "flex-1 flex items-center justify-center p-6 sm:p-12",
          "bg-background surface-page",
        )}
      >
        <Box className="w-full max-w-md">
          {/* Mobile logo */}
          <Box className="lg:hidden mb-8 text-center">
            <Link to="/" className="inline-flex items-center gap-3">
              {logo || (
                <Box className="w-12 h-12 bg-primary rounded-container flex items-center justify-center">
                  <Typography
                    variant="body1"
                    className="text-primary-foreground font-bold text-xl"
                  >
                    {appName.charAt(0).toUpperCase()}
                  </Typography>
                </Box>
              )}
              <Typography
                variant="body1"
                className="text-2xl font-bold text-foreground"
              >
                {appName}
              </Typography>
            </Link>
          </Box>

          {/* Auth form content (from child routes) */}
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

AuthLayout.displayName = "AuthLayout";
