output "domain_name" {
  description = "CloudFront address of the website, e.g. d111111abcdef8.cloudfront.net"
  value       = aws_cloudfront_distribution.site.domain_name
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "bucket_name" {
  value = aws_s3_bucket.site.id
}
