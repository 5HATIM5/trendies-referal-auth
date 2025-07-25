import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
  import { JwtService } from '@nestjs/jwt';
  import * as bcrypt from 'bcrypt';

import { Provider } from '../../generated/prisma';
import { PrismaService } from '@prisma/prisma.service';
import { parseDate } from '@lib/helperFunctions/parseDate';
import { RegisterDto, LoginDto, AuthResponseDto, OAuthLoginDto, UserDto } from '@auth/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger
  ) {}

  async register(dto: RegisterDto) {   
    this.logger.info({ email: dto.email }, 'Register attempt'); 

    //check if user already exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email },
          { phoneNo: dto.phoneNo },
        ],
      },
    });
    if (existingUser) {
      if (existingUser.email === dto.email) {
        this.logger.warn({ email: dto.email }, 'Registration failed: Email already registered');
        throw new UnauthorizedException('Email already registered');
      }
      if (existingUser.phoneNo === dto.phoneNo) {
        this.logger.warn({ phoneNo: dto.phoneNo }, 'Registration failed: Phone number already registered');
        throw new UnauthorizedException('Phone number already registered');
      }
    }

    const hash = await bcrypt.hash(dto.password, 10);
  
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hash,
        name: dto.name,
        surname: dto.surname,
        dateOfBirth: parseDate(dto.dateOfBirth),
        phoneNo: dto.phoneNo,
        provider: Provider.EMAIL,
      }
    });

     let authResponse: AuthResponseDto;
     try {
       authResponse = this.generateAuthResponse(user);
       if (!authResponse.accessToken) {
        this.logger.error('Token generation failed');
        throw new Error('Token generation failed');
       }
     } catch (err) {
       this.logger.error('Registration failed: ' + err.message);
       throw new UnauthorizedException('Registration failed: ' + err.message);
     }
 
     return authResponse;
  }

  async login(dto: LoginDto) {    
    this.logger.info({ email: dto.email }, 'Login attempt');

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.password) {
      this.logger.warn({ email: dto.email }, 'Login failed: Invalid credentials');
      throw new UnauthorizedException('Invalid credentials');
    }

    const match = await bcrypt.compare(dto.password, user.password);    
    if (!match) {
      this.logger.warn({ email: dto.email }, 'Login failed: Invalid credentials');
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.info({ email: dto.email }, 'Login successful');
    return this.generateAuthResponse(user);
  }

  async oauthLogin(dto: OAuthLoginDto) {
    this.logger.info({ email: dto.email }, 'OAuth login attempt');

    const user = await this.prisma.oAuthUser.findUnique({ where: { email: dto.email } });
  
    if (user) {
      this.logger.info({ email: dto.email }, 'OAuth login successful');
      return this.generateAuthResponse({
        id: user.id,
        email: user.email,
        name: user.fullName.split(' ')[0],
        surname: user.fullName.split(' ')[1],
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    }
  
    const newUser = await this.prisma.oAuthUser.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        provider: dto.provider as Provider, 
      },
    });
  
    return this.generateAuthResponse({
      id: newUser.id,
      email: newUser.email,
      name: newUser.fullName.split(' ')[0],
      surname: newUser.fullName.split(' ')[1],
      createdAt: newUser.createdAt,
      updatedAt: newUser.updatedAt,
    });
  }
  
  private generateToken(userId: string, email: string) {
    const payload = { sub: userId, email };
    return {
      accessToken: this.jwtService.sign(payload),
      expiresIn: 3600, 
    };
  }

  private generateAuthResponse(user: UserDto): AuthResponseDto {
    const token = this.generateToken(user.id, user.email);
    return {
      ...token,
      user: user
    };
  }
}
