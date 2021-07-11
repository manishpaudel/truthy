import { Test, TestingModule } from '@nestjs/testing';
import { RefreshTokenService } from './refresh-token.service';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth/auth.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { UserSerializer } from '../auth/serializer/user.serializer';
import { RefreshToken } from './entities/refresh-token.entity';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { TokenExpiredError } from 'jsonwebtoken';
import exp from 'constants';

const jwtServiceMock = () => ({
  signAsync: jest.fn(),
  verifyAsync: jest.fn()
});

const authServiceMock = () => ({
  findById: jest.fn()
});

const repositoryMock = () => ({
  createRefreshToken: jest.fn(),
  findTokenById: jest.fn(),
  find: jest.fn()
});

describe('RefreshTokenService', () => {
  let service: RefreshTokenService,
    jwtService,
    authService,
    repository,
    user: UserSerializer,
    refreshToken: RefreshToken;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: JwtService, useFactory: jwtServiceMock },
        { provide: AuthService, useFactory: authServiceMock },
        { provide: RefreshTokenRepository, useFactory: repositoryMock }
      ]
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
    jwtService = await module.get<JwtService>(JwtService);
    authService = await module.get<AuthService>(AuthService);
    repository = await module.get<RefreshTokenRepository>(
      RefreshTokenRepository
    );
    user = new UserSerializer();
    user.id = 1;
    user.email = 'test@mail.com';
    refreshToken = new RefreshToken();
    refreshToken.id = 1;
    refreshToken.userId = 1;
    refreshToken.isRevoked = false;
    refreshToken.save = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('generate access token', async () => {
    await service.generateAccessToken(user);
    expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
  });

  it('generate refresh token', async () => {
    repository.createRefreshToken.mockResolvedValue(refreshToken);
    const tokenPayload = {
      ip: '::1',
      userAgent: 'mozilla'
    };
    await service.generateRefreshToken(user, tokenPayload);
    expect(repository.createRefreshToken).toHaveBeenCalledTimes(1);
    expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
  });

  describe('resolveRefreshToken', () => {
    it('test for malformed token', async () => {
      const testToken = 'test_token_hash';
      jest
        .spyOn(service, 'decodeRefreshToken')
        .mockResolvedValue({ jti: 1, sub: 1 });
      jest
        .spyOn(service, 'getStoredTokenFromRefreshTokenPayload')
        .mockResolvedValue(refreshToken);
      jest
        .spyOn(service, 'getUserFromRefreshTokenPayload')
        .mockResolvedValue(null);
      await expect(service.resolveRefreshToken(testToken)).rejects.toThrowError(
        BadRequestException
      );
      expect(service.decodeRefreshToken).toHaveBeenCalledTimes(1);
      expect(
        service.getStoredTokenFromRefreshTokenPayload
      ).toHaveBeenCalledTimes(1);
      expect(
        service.getStoredTokenFromRefreshTokenPayload
      ).toHaveBeenCalledTimes(1);
    });

    it('resolve refresh token for valid refresh token', async () => {
      const testToken = 'test_token_hash';
      jest
        .spyOn(service, 'decodeRefreshToken')
        .mockResolvedValue({ jti: 1, sub: 1 });
      jest
        .spyOn(service, 'getStoredTokenFromRefreshTokenPayload')
        .mockResolvedValue(refreshToken);
      jest
        .spyOn(service, 'getUserFromRefreshTokenPayload')
        .mockResolvedValue(user);
      await service.resolveRefreshToken(testToken);
      expect(service.decodeRefreshToken).toHaveBeenCalledTimes(1);
      expect(service.decodeRefreshToken).toHaveBeenCalledWith(testToken);
      expect(
        service.getStoredTokenFromRefreshTokenPayload
      ).toHaveBeenCalledTimes(1);
      expect(
        service.getStoredTokenFromRefreshTokenPayload
      ).toHaveBeenCalledWith({
        jti: 1,
        sub: 1
      });
    });
  });

  it('createAccessTokenFromRefreshToken', async () => {
    jest
      .spyOn(service, 'resolveRefreshToken')
      .mockResolvedValue({ user, token: refreshToken });
    jest
      .spyOn(service, 'generateAccessToken')
      .mockResolvedValue('refresh_token_hash');
    await service.createAccessTokenFromRefreshToken('old_token_hash');
    expect(service.resolveRefreshToken).toHaveBeenCalledWith('old_token_hash');
    expect(service.resolveRefreshToken).toHaveBeenCalledTimes(1);
    expect(service.generateAccessToken).toHaveBeenCalledTimes(1);
    expect(service.generateAccessToken).toHaveBeenCalledWith(user);
  });

  describe('decodeRefreshToken', () => {
    it('check token expired error', async () => {
      jwtService.verifyAsync.mockImplementation(() => {
        throw new TokenExpiredError('tokenExpired', new Date());
      });

      await expect(
        service.decodeRefreshToken('refresh_token_hash')
      ).rejects.toThrowError(BadRequestException);
    });

    it('decode valid refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({ jti: 1, sub: 1 });
      await service.decodeRefreshToken('refresh_token_hash');
      expect(jwtService.verifyAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('refresh_token_hash');
    });
  });

  describe('getUserFromRefreshTokenPayload', () => {
    it('check get user from refresh token with malformed token', async () => {
      await expect(
        service.getUserFromRefreshTokenPayload({ jti: null, sub: null })
      ).rejects.toThrowError(BadRequestException);
      expect(authService.findById).toHaveBeenCalledTimes(0);
    });

    it('get user from valid refresh token', async () => {
      authService.findById.mockResolvedValue(user);
      await expect(
        service.getUserFromRefreshTokenPayload({ jti: 1, sub: 1 })
      ).resolves.not.toThrow();
      expect(authService.findById).toHaveBeenCalledTimes(1);
      expect(authService.findById).toHaveBeenCalledWith(1);
    });
  });

  describe('getStoredTokenFromRefreshTokenPayload', () => {
    it('check for malformed token', async () => {
      await expect(
        service.getStoredTokenFromRefreshTokenPayload({ jti: null, sub: null })
      ).rejects.toThrowError(BadRequestException);
    });

    it('get stored token from refresh token payload', async () => {
      repository.findTokenById.mockResolvedValue(refreshToken);
      await expect(
        service.getStoredTokenFromRefreshTokenPayload({ jti: 1, sub: 1 })
      ).resolves.not.toThrow();
      expect(repository.findTokenById).toHaveBeenCalledTimes(1);
    });
  });

  it('getRefreshTokenByUserId', async () => {
    const userId = 1;
    await service.getRefreshTokenByUserId(userId);
    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith({
      where: {
        userId,
        isRevoked: false
      }
    });
  });

  describe('revokeRefreshTokenById', () => {
    it('revoke refresh token error for invalid id', async () => {
      repository.findTokenById.mockResolvedValue(null);
      await expect(service.revokeRefreshTokenById(1, 1)).rejects.toThrowError(
        NotFoundException
      );
      expect(repository.findTokenById).toHaveBeenCalledTimes(1);
    });

    it('revoke refresh token of another user', async () => {
      jest.spyOn(repository, 'findTokenById').mockResolvedValue({
        userId: 2,
        save: jest.fn()
      });
      await expect(service.revokeRefreshTokenById(1, 1)).rejects.toThrowError(
        ForbiddenException
      );
      expect(repository.findTokenById).toHaveBeenCalledTimes(1);
    });

    it('revoke refresh token for valid id', async () => {
      jest.spyOn(repository, 'findTokenById').mockResolvedValue({
        userId: 1,
        save: jest.fn()
      });
      const result = await service.revokeRefreshTokenById(1, 1);
      expect(repository.findTokenById).toHaveBeenCalledTimes(1);
      expect(result.save).toHaveBeenCalledTimes(1);
    });
  });
});