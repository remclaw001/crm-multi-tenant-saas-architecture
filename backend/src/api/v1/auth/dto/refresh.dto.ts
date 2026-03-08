import { IsString, IsNotEmpty, Length } from 'class-validator';

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  @Length(96, 96)
  refreshToken!: string;
}
