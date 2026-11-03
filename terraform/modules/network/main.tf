terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# A small private network for the API Lambda. It has no internet access at all (no internet
# gateway, no NAT gateway), so everything here stays free. The Lambda only talks to S3 and
# DynamoDB, and it does that through free "gateway endpoints" that stay inside the AWS network.
#
# The processor Lambda is NOT placed here: it must call the Gemini API on the internet, and
# that would need a NAT gateway (about $30 a month), which breaks the free-tier constraint.

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_region" "current" {}

locals {
  name = "${var.project_name}-${var.environment}"

  # Two zones: if one zone has a problem, the Lambda can still start in the other.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name}-vpc"
  }
}

# Private subnets: their route table has no route to the internet.
resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name}-private-${local.azs[count.index]}"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name}-private"
  }
}

resource "aws_route_table_association" "private" {
  count = length(aws_subnet.private)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# --- Gateway endpoints (free): S3 and DynamoDB are reached without leaving AWS ---
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = {
    Name = "${local.name}-s3"
  }
}

resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = {
    Name = "${local.name}-dynamodb"
  }
}

# --- Security group of the API Lambda ---
# No inbound rules: nothing connects to the Lambda, API Gateway invokes it through the Lambda
# service. Outbound: HTTPS to the S3 and DynamoDB endpoints only, nowhere else.
resource "aws_security_group" "lambda" {
  name        = "${local.name}-api-lambda"
  description = "API Lambda: no inbound traffic, outbound HTTPS to S3 and DynamoDB only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-api-lambda"
  }
}

resource "aws_vpc_security_group_egress_rule" "to_s3" {
  security_group_id = aws_security_group.lambda.id
  description       = "HTTPS to S3 (gateway endpoint)"
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "to_dynamodb" {
  security_group_id = aws_security_group.lambda.id
  description       = "HTTPS to DynamoDB (gateway endpoint)"
  prefix_list_id    = aws_vpc_endpoint.dynamodb.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
