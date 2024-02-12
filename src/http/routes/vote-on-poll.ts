import { FastifyInstance } from "fastify";
import z from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/redis";
import { voting } from "../../utils/voting-pub-sub";

export async function voteOnPoll(app: FastifyInstance) {
  app.post('/polls/:pollId/votes', async (request, reply) => {
    const voteOnPollBodySchema = z.object({
      pollOptionId: z.string().uuid(),
    })

    const voteOnPollParamsSchema = z.object({
      pollId: z.string().uuid(),
    })
  
    const { pollId } = voteOnPollParamsSchema.parse(request.params)
    const { pollOptionId } = voteOnPollBodySchema.parse(request.body)

    let { sessionId } = request.cookies

    if (sessionId) {
      const userAlreadyVotedOnPoll = await prisma.vote.findUnique({
        where: {
          sessionId_pollId: {
            pollId,
            sessionId,
          }
        }
      })

      if (userAlreadyVotedOnPoll && userAlreadyVotedOnPoll.pollOptionId !== pollOptionId) {
        await prisma.vote.delete({
          where: {
            id: userAlreadyVotedOnPoll.id
          }
        })

        await redis.zincrby(pollId, -1, userAlreadyVotedOnPoll.pollOptionId)
        
      } else if (userAlreadyVotedOnPoll) {
        return reply.status(400).send({ message: 'User already voted on this poll'})
      }
    }

    if (!sessionId) {
      sessionId = randomUUID()
      reply.setCookie('sessionId', sessionId, {
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        signed: true,
        httpOnly: true,
      })
    }

    await prisma.vote.create({
      data: {
        pollId,
        sessionId,
        pollOptionId,
      }
    })

    const votes = await redis.zincrby(pollId, 1, pollOptionId)

    voting.publish(pollId, {
      pollOptionId,
      votes: parseInt(votes),
    })
    
    return reply.status(201).send()
  })
}