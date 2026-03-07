output "cluster_arn" {
  value = aws_ecs_cluster.main.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  value = aws_lb.internal.dns_name
}

output "alb_zone_id" {
  value = aws_lb.internal.zone_id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "task_execution_role_arn" {
  value = aws_iam_role.task_execution.arn
}

output "alb_arn" {
  value = aws_lb.internal.arn
}

output "alb_listener_arn" {
  value = aws_lb_listener.http.arn
}

################################################################################
# Backend API (Public ALB)
################################################################################

output "public_alb_dns_name" {
  value = aws_lb.public.dns_name
}

output "public_alb_zone_id" {
  value = aws_lb.public.zone_id
}

output "backend_service_name" {
  value = aws_ecs_service.backend.name
}

output "backend_security_group_id" {
  value = aws_security_group.backend_tasks.id
}
