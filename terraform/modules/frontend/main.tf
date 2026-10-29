terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "${var.project_name}-${var.environment}"

  # Every file "npm run build" produced, except config.json: Terraform writes that one itself.
  files = setsubtract(fileset(var.dist_dir, "**"), ["config.json"])

  content_types = {
    html        = "text/html; charset=utf-8"
    js          = "text/javascript"
    css         = "text/css"
    json        = "application/json"
    svg         = "image/svg+xml"
    png         = "image/png"
    jpg         = "image/jpeg"
    ico         = "image/x-icon"
    woff        = "font/woff"
    woff2       = "font/woff2"
    txt         = "text/plain"
    map         = "application/json"
    webmanifest = "application/manifest+json"
  }
}

# Only a warning: lets "terraform plan" work before the first build.
check "website_is_built" {
  assert {
    condition     = length(local.files) > 0
    error_message = "${var.dist_dir} is empty. Run \"npm run build\" in frontend/ and apply again, otherwise the site is empty."
  }
}

# --- Storage: a private bucket. Only CloudFront may read it. ---
resource "aws_s3_bucket" "site" {
  bucket = "${local.name}-site-${data.aws_caller_identity.current.account_id}"

  # Lets "terraform destroy" delete the bucket together with the site files.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- CloudFront: HTTPS, caching and compression in front of the bucket ---
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${local.name}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS-managed policies, so there is nothing to maintain.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "${local.name} website"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # Europe + North America: the cheapest option
  http_version        = "http2and3"
  is_ipv6_enabled     = true

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  # A private bucket answers 403 for a missing file. Show the app instead of an XML error.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true # https://<id>.cloudfront.net
  }
}

data "aws_iam_policy_document" "site" {
  statement {
    sid       = "ReadOnlyFromThisDistribution"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}

# --- The website files. Terraform uploads them, so "terraform apply" is the whole deploy. ---
# Hashed files in assets/ never change, so they may be cached for a year. index.html and
# config.json must always be fresh: "no-cache" makes browsers and CloudFront re-check them,
# which means no CloudFront invalidation is needed after a deploy.
resource "aws_s3_object" "files" {
  for_each = local.files

  bucket       = aws_s3_bucket.site.id
  key          = each.value
  source       = "${var.dist_dir}/${each.value}"
  source_hash  = filemd5("${var.dist_dir}/${each.value}")
  content_type = lookup(local.content_types, lower(regex("[^.]*$", each.value)), "application/octet-stream")
  cache_control = (
    startswith(each.value, "assets/") ? "public, max-age=31536000, immutable" : "no-cache"
  )
}

# Where the API, the user pool and the app client live. Written by Terraform, so the same
# build works in dev and prod and no URL is ever copied by hand.
resource "aws_s3_object" "config" {
  bucket        = aws_s3_bucket.site.id
  key           = "config.json"
  content       = jsonencode(var.config)
  content_type  = "application/json"
  cache_control = "no-cache"
}
