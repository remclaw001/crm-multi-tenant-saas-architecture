import { Module } from '@nestjs/common';
import { ApiV1Controller } from './api-v1.controller';

@Module({
  controllers: [ApiV1Controller],
})
export class ApiV1Module {}
